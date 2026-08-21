begin;

alter table public.inventory_items
  add column if not exists consumption_mode text not null default 'whole_pack',
  add column if not exists default_consume_quantity numeric(20,6);

alter table public.inventory_items
  drop constraint if exists inventory_items_consumption_mode_check;
alter table public.inventory_items
  add constraint inventory_items_consumption_mode_check
  check (consumption_mode in ('whole_pack','partial_pack'));

alter table public.inventory_items
  drop constraint if exists inventory_items_default_consume_quantity_check;
alter table public.inventory_items
  add constraint inventory_items_default_consume_quantity_check
  check (default_consume_quantity is null or (default_consume_quantity>0 and default_consume_quantity<=1000000000));

alter table public.inventory_stock_units
  add column if not exists remaining_quantity numeric(20,6),
  add column if not exists last_consumed_at timestamptz;

update public.inventory_stock_units
   set remaining_quantity=case when status='available' then base_quantity else 0 end
 where remaining_quantity is null;

alter table public.inventory_stock_units
  alter column remaining_quantity set not null;

alter table public.inventory_stock_units
  drop constraint if exists inventory_stock_units_remaining_quantity_check;
alter table public.inventory_stock_units
  add constraint inventory_stock_units_remaining_quantity_check
  check (remaining_quantity>=0 and remaining_quantity<=base_quantity);

create or replace function public.aora_inventory_stock_unit_remaining_default()
returns trigger
language plpgsql
set search_path=public,extensions,pg_temp
as $$
begin
  if new.remaining_quantity is null then
    new.remaining_quantity:=case when coalesce(new.status,'available')='available' then new.base_quantity else 0 end;
  end if;
  return new;
end $$;

drop trigger if exists inventory_stock_unit_remaining_default on public.inventory_stock_units;
create trigger inventory_stock_unit_remaining_default
before insert on public.inventory_stock_units
for each row execute function public.aora_inventory_stock_unit_remaining_default();

create or replace function public.aora_inventory_consume_stock_unit(
  p_organization_id uuid,
  p_location_id text,
  p_stock_unit_id uuid,
  p_requested_quantity numeric,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key text,
  p_reference_type text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_existing jsonb;
  v_unit public.inventory_stock_units%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_mode text;
  v_default numeric(20,6);
  v_qty numeric(20,6);
  v_remaining numeric(20,6);
  v_movement_id uuid:=gen_random_uuid();
  v_result jsonb;
begin
  if nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 220 then
    raise exception using errcode='22023',message='inventory_idempotency_invalid';
  end if;
  if p_actor_role not in('owner','manager','employee','system') then
    raise exception using errcode='22023',message='inventory_actor_invalid';
  end if;

  select result_snapshot into v_existing
    from public.inventory_movements
   where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return v_existing||jsonb_build_object('idempotent',true); end if;

  select * into v_unit
    from public.inventory_stock_units
   where organization_id=p_organization_id and id=p_stock_unit_id
   for update;
  if not found then raise exception using errcode='P0002',message='inventory_qr_not_found'; end if;
  if v_unit.location_id<>p_location_id or v_unit.status<>'available' or v_unit.remaining_quantity<=0 then
    raise exception using errcode='P0001',message='inventory_qr_already_used_or_wrong_location';
  end if;

  select consumption_mode,default_consume_quantity
    into v_mode,v_default
    from public.inventory_items
   where organization_id=p_organization_id and id=v_unit.item_id;
  if not found then raise exception using errcode='P0002',message='inventory_item_not_found'; end if;

  if v_mode='whole_pack' then
    if p_requested_quantity is not null and abs(p_requested_quantity-v_unit.remaining_quantity)>0.000001 then
      raise exception using errcode='22023',message='inventory_qr_partial_not_allowed';
    end if;
    v_qty:=v_unit.remaining_quantity;
  else
    v_qty:=coalesce(p_requested_quantity,v_default);
    if v_qty is null then raise exception using errcode='22023',message='inventory_qr_partial_quantity_required'; end if;
    if v_qty<=0 or v_qty>v_unit.remaining_quantity then
      raise exception using errcode='22023',message='inventory_qr_partial_quantity_invalid';
    end if;
  end if;

  select * into v_balance
    from public.inventory_balances
   where organization_id=p_organization_id and location_id=p_location_id and item_id=v_unit.item_id
   for update;
  if not found then raise exception using errcode='P0002',message='inventory_balance_not_found'; end if;
  if v_balance.on_hand<v_qty then raise exception using errcode='P0001',message='inventory_balance_invariant_failed'; end if;

  v_remaining:=greatest(0,v_unit.remaining_quantity-v_qty);
  update public.inventory_stock_units
     set remaining_quantity=v_remaining,
         status=case when v_remaining=0 then 'issued' else 'available' end,
         issued_by=case when v_remaining=0 then p_actor_id else issued_by end,
         issued_at=case when v_remaining=0 then clock_timestamp() else issued_at end,
         last_consumed_at=clock_timestamp(),
         version=version+1,
         updated_at=clock_timestamp()
   where organization_id=p_organization_id and id=v_unit.id;

  v_result:=jsonb_build_object(
    'movementId',v_movement_id,
    'stockUnitId',v_unit.id,
    'itemId',v_unit.item_id,
    'packUnitId',v_unit.pack_unit_id,
    'consumptionMode',v_mode,
    'consumedQuantity',v_qty,
    'quantityDelta',-v_qty,
    'remainingQuantity',v_remaining,
    'onHand',v_balance.on_hand-v_qty,
    'idempotent',false
  );

  insert into public.inventory_movements(
    organization_id,id,location_id,item_id,stock_unit_id,movement_type,quantity_delta,
    reference_type,reference_id,actor_id,actor_role,idempotency_key,result_snapshot
  ) values(
    p_organization_id,v_movement_id,p_location_id,v_unit.item_id,v_unit.id,'consumption',-v_qty,
    left(coalesce(nullif(trim(p_reference_type),''),'qr_scan'),80),v_unit.id::text,
    p_actor_id,p_actor_role,p_idempotency_key,v_result
  );

  update public.inventory_balances
     set on_hand=on_hand-v_qty,version=version+1,updated_at=clock_timestamp()
   where organization_id=p_organization_id and location_id=p_location_id and item_id=v_unit.item_id;

  perform public.aora_inventory_evaluate_replenishment(p_organization_id,p_location_id,v_unit.item_id);
  return v_result;
end $$;

create or replace function public.aora_inventory_consume_qr_unit(
  p_organization_id uuid,
  p_location_id text,
  p_token_hash_hex text,
  p_requested_quantity numeric,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id
    from public.inventory_stock_units
   where organization_id=p_organization_id and token_hash=decode(p_token_hash_hex,'hex');
  if not found then raise exception using errcode='P0002',message='inventory_qr_not_found'; end if;
  return public.aora_inventory_consume_stock_unit(
    p_organization_id,p_location_id,v_id,p_requested_quantity,p_actor_id,p_actor_role,p_idempotency_key,'qr_scan'
  );
end $$;

create or replace function public.aora_inventory_consume_qr_short_code(
  p_organization_id uuid,
  p_location_id text,
  p_short_code text,
  p_requested_quantity numeric,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id
    from public.inventory_stock_units
   where organization_id=p_organization_id and upper(short_code)=upper(trim(p_short_code));
  if not found then raise exception using errcode='P0002',message='inventory_qr_not_found'; end if;
  return public.aora_inventory_consume_stock_unit(
    p_organization_id,p_location_id,v_id,p_requested_quantity,p_actor_id,p_actor_role,p_idempotency_key,'qr_short_code'
  );
end $$;

revoke all on function public.aora_inventory_consume_stock_unit(uuid,text,uuid,numeric,text,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_consume_qr_unit(uuid,text,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_consume_qr_short_code(uuid,text,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_consume_stock_unit(uuid,text,uuid,numeric,text,text,text,text) to service_role;
grant execute on function public.aora_inventory_consume_qr_unit(uuid,text,text,numeric,text,text,text) to service_role;
grant execute on function public.aora_inventory_consume_qr_short_code(uuid,text,text,numeric,text,text,text) to service_role;

commit;
