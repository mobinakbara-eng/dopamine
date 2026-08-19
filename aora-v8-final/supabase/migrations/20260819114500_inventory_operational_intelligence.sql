begin;

-- ---------------------------------------------------------------------------
-- AORA Inventory Operational Intelligence
-- - exception-first receiving
-- - partial QR consumption with per-label remaining quantity
-- - offline-safe physical count reconstruction from the immutable ledger
-- ---------------------------------------------------------------------------

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

alter table public.inventory_count_lines
  add column if not exists client_counted_at timestamptz,
  add column if not exists baseline_reconstructed boolean not null default false;

alter table public.inventory_goods_receipts
  drop constraint if exists inventory_goods_receipts_status_check;
alter table public.inventory_goods_receipts
  add constraint inventory_goods_receipts_status_check
  check (status in ('received','received_with_exceptions','reversed'));

create table if not exists public.inventory_receipt_exceptions(
  organization_id uuid not null,
  id uuid not null default gen_random_uuid(),
  receipt_id uuid not null,
  purchase_order_id uuid,
  location_id text not null,
  item_id uuid not null,
  pack_unit_id uuid not null,
  exception_type text not null,
  pack_count integer not null,
  base_quantity numeric(20,6) not null,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key(organization_id,id),
  constraint inventory_receipt_exceptions_receipt_fk foreign key(organization_id,receipt_id)
    references public.inventory_goods_receipts(organization_id,id) on delete restrict,
  constraint inventory_receipt_exceptions_po_fk foreign key(organization_id,purchase_order_id)
    references public.inventory_purchase_orders(organization_id,id) on delete restrict,
  constraint inventory_receipt_exceptions_location_fk foreign key(organization_id,location_id)
    references public.locations(organization_id,id) on delete restrict,
  constraint inventory_receipt_exceptions_item_fk foreign key(organization_id,item_id)
    references public.inventory_items(organization_id,id) on delete restrict,
  constraint inventory_receipt_exceptions_pack_fk foreign key(organization_id,pack_unit_id)
    references public.inventory_pack_units(organization_id,id) on delete restrict,
  constraint inventory_receipt_exceptions_type_check check(exception_type in ('damaged','missing','rejected')),
  constraint inventory_receipt_exceptions_pack_count_check check(pack_count>0 and pack_count<=10000),
  constraint inventory_receipt_exceptions_base_quantity_check check(base_quantity>0)
);

create index if not exists inventory_receipt_exceptions_po_idx
  on public.inventory_receipt_exceptions(organization_id,purchase_order_id,created_at desc);
create index if not exists inventory_receipt_exceptions_item_idx
  on public.inventory_receipt_exceptions(organization_id,location_id,item_id,created_at desc);

alter table public.inventory_receipt_exceptions enable row level security;
drop policy if exists inventory_deny_direct_client on public.inventory_receipt_exceptions;
create policy inventory_deny_direct_client on public.inventory_receipt_exceptions
  for all to anon,authenticated using(false) with check(false);
revoke all on public.inventory_receipt_exceptions from public,anon,authenticated;

-- Save a physical count at the moment it was actually counted. When a device was
-- offline, p_counted_at is a server-clock estimate captured by the client. The
-- authoritative historical on-hand is reconstructed as current on-hand minus all
-- immutable ledger deltas that happened after that instant while the balance row
-- is locked. This preserves later receipts/consumption instead of overwriting them.
create or replace function public.aora_inventory_set_count_line_at(
  p_organization_id uuid,
  p_count_id uuid,
  p_item_id uuid,
  p_counted_quantity numeric,
  p_actor_id text,
  p_counted_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line public.inventory_count_lines%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_at timestamptz:=coalesce(p_counted_at,clock_timestamp());
  v_after numeric(20,6):=0;
  v_after_count bigint:=0;
  v_baseline numeric(20,6);
  v_baseline_version bigint;
  v_reconstructed boolean:=p_counted_at is not null;
begin
  if p_counted_quantity is null or p_counted_quantity<0 or p_counted_quantity>1000000000 then
    raise exception using errcode='22023',message='inventory_count_quantity_invalid';
  end if;

  select * into v_count
    from public.inventory_counts
   where organization_id=p_organization_id and id=p_count_id
   for update;
  if not found then raise exception using errcode='P0002',message='inventory_count_not_found'; end if;
  if v_count.status<>'counting' then raise exception using errcode='P0001',message='inventory_count_state_invalid'; end if;

  if v_at < v_count.created_at-interval '2 minutes'
     or v_at > clock_timestamp()+interval '2 minutes'
     or v_at < clock_timestamp()-interval '7 days' then
    raise exception using errcode='22023',message='inventory_count_timestamp_invalid';
  end if;

  select * into v_line
    from public.inventory_count_lines
   where organization_id=p_organization_id and count_id=p_count_id and item_id=p_item_id
   for update;
  if not found then raise exception using errcode='P0002',message='inventory_count_line_not_found'; end if;

  if v_line.baseline_version is null then
    select * into v_balance
      from public.inventory_balances
     where organization_id=p_organization_id and location_id=v_count.location_id and item_id=p_item_id
     for update;
    if not found then raise exception using errcode='P0002',message='inventory_balance_not_found'; end if;

    select coalesce(sum(quantity_delta),0),count(*)
      into v_after,v_after_count
      from public.inventory_movements
     where organization_id=p_organization_id
       and location_id=v_count.location_id
       and item_id=p_item_id
       and occurred_at>v_at;

    v_baseline:=v_balance.on_hand-v_after;
    if v_baseline<0 then
      raise exception using errcode='P0001',message='inventory_count_history_invariant_failed';
    end if;
    v_baseline_version:=greatest(1,v_balance.version-v_after_count);

    update public.inventory_count_lines
       set system_quantity=v_baseline,
           baseline_version=v_baseline_version,
           baseline_captured_at=v_at,
           client_counted_at=p_counted_at,
           baseline_reconstructed=v_reconstructed,
           counted_quantity=p_counted_quantity,
           updated_by=p_actor_id,
           updated_at=clock_timestamp()
     where organization_id=p_organization_id and count_id=p_count_id and item_id=p_item_id
     returning * into v_line;
  else
    update public.inventory_count_lines
       set counted_quantity=p_counted_quantity,
           updated_by=p_actor_id,
           updated_at=clock_timestamp()
     where organization_id=p_organization_id and count_id=p_count_id and item_id=p_item_id
     returning * into v_line;
  end if;

  return jsonb_build_object(
    'countId',p_count_id,
    'itemId',p_item_id,
    'countedQuantity',v_line.counted_quantity,
    'baselineQuantity',v_line.system_quantity,
    'baselineVersion',v_line.baseline_version,
    'baselineCapturedAt',v_line.baseline_captured_at,
    'variance',v_line.variance,
    'offlineReconstructed',v_line.baseline_reconstructed
  );
end $$;

create or replace function public.aora_inventory_set_count_line(
  p_organization_id uuid,
  p_count_id uuid,
  p_item_id uuid,
  p_counted_quantity numeric,
  p_actor_id text
) returns jsonb
language sql
security definer
set search_path=public,extensions,pg_temp
as $$
  select public.aora_inventory_set_count_line_at($1,$2,$3,$4,$5,null);
$$;

-- Internal worker for both full-pack and partial-pack QR consumption. The same
-- idempotency key can be replayed after a mobile network timeout without taking
-- stock twice.
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

  select su.*,i.consumption_mode,i.default_consume_quantity
    into v_unit,v_mode,v_default
    from public.inventory_stock_units su
    join public.inventory_items i on i.organization_id=su.organization_id and i.id=su.item_id
   where su.organization_id=p_organization_id and su.id=p_stock_unit_id
   for update of su;
  if not found then raise exception using errcode='P0002',message='inventory_qr_not_found'; end if;
  if v_unit.location_id<>p_location_id or v_unit.status<>'available' or v_unit.remaining_quantity<=0 then
    raise exception using errcode='P0001',message='inventory_qr_already_used_or_wrong_location';
  end if;

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
  select id into v_id from public.inventory_stock_units
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
  select id into v_id from public.inventory_stock_units
   where organization_id=p_organization_id and upper(short_code)=upper(trim(p_short_code));
  if not found then raise exception using errcode='P0002',message='inventory_qr_not_found'; end if;
  return public.aora_inventory_consume_stock_unit(
    p_organization_id,p_location_id,v_id,p_requested_quantity,p_actor_id,p_actor_role,p_idempotency_key,'qr_short_code'
  );
end $$;

-- One delivery = one atomic receipt. The manager starts from "everything arrived"
-- and only edits exceptions. Good quantity enters stock; damaged/missing quantity is
-- audit evidence only and keeps the PO open for follow-up.
create or replace function public.aora_inventory_receive_purchase_order_delivery(
  p_organization_id uuid,
  p_location_id text,
  p_purchase_order_id uuid,
  p_lines jsonb,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_receipt_id uuid:=gen_random_uuid();
  v_existing public.inventory_goods_receipts%rowtype;
  v_input record;
  v_line public.inventory_purchase_order_lines%rowtype;
  v_pack public.inventory_pack_units%rowtype;
  v_open numeric(20,6);
  v_good numeric(20,6);
  v_damaged numeric(20,6);
  v_missing numeric(20,6);
  v_observed numeric(20,6);
  v_line_no integer:=0;
  v_exception_count integer:=0;
  v_good_line_count integer:=0;
  v_print_jobs jsonb:='[]'::jsonb;
  v_print_job_id uuid;
  v_status text;
  v_move jsonb;
  v_result jsonb;
begin
  if p_actor_role not in('owner','manager') then raise exception using errcode='42501',message='inventory_receipt_actor_forbidden'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then
    raise exception using errcode='22023',message='inventory_receipt_lines_invalid';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception using errcode='22023',message='inventory_idempotency_invalid'; end if;

  select * into v_existing
    from public.inventory_goods_receipts
   where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    select coalesce(jsonb_agg(id order by created_at),'[]'::jsonb) into v_print_jobs
      from public.inventory_label_print_jobs
     where organization_id=p_organization_id and receipt_id=v_existing.id;
    return jsonb_build_object('receiptId',v_existing.id,'status',v_existing.status,'printJobIds',v_print_jobs,'idempotent',true);
  end if;

  select * into v_order
    from public.inventory_purchase_orders
   where organization_id=p_organization_id and id=p_purchase_order_id and location_id=p_location_id
     and status in('submitted','placed','delivered','partially_received')
   for update;
  if not found then raise exception using errcode='P0001',message='inventory_purchase_order_not_receivable'; end if;

  insert into public.inventory_goods_receipts(
    organization_id,id,location_id,purchase_order_id,status,idempotency_key,received_by
  ) values(
    p_organization_id,v_receipt_id,p_location_id,p_purchase_order_id,'received',p_idempotency_key,p_actor_id
  );

  for v_input in
    select * from jsonb_to_recordset(p_lines) as x(
      item_id uuid,
      pack_unit_id uuid,
      good_pack_count integer,
      damaged_pack_count integer,
      missing_pack_count integer,
      note text
    )
  loop
    if v_input.item_id is null or v_input.pack_unit_id is null then
      raise exception using errcode='22023',message='inventory_receipt_line_invalid';
    end if;
    if coalesce(v_input.good_pack_count,0)<0 or coalesce(v_input.damaged_pack_count,0)<0 or coalesce(v_input.missing_pack_count,0)<0
       or coalesce(v_input.good_pack_count,0)>10000 or coalesce(v_input.damaged_pack_count,0)>10000 or coalesce(v_input.missing_pack_count,0)>10000 then
      raise exception using errcode='22023',message='inventory_receipt_quantity_invalid';
    end if;
    if coalesce(v_input.good_pack_count,0)+coalesce(v_input.damaged_pack_count,0)+coalesce(v_input.missing_pack_count,0)<=0 then
      raise exception using errcode='22023',message='inventory_receipt_quantity_invalid';
    end if;

    select * into v_line
      from public.inventory_purchase_order_lines
     where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and item_id=v_input.item_id
     for update;
    if not found then raise exception using errcode='P0002',message='inventory_purchase_order_line_not_found'; end if;

    select * into v_pack
      from public.inventory_pack_units
     where organization_id=p_organization_id and id=v_input.pack_unit_id and item_id=v_input.item_id and active=true;
    if not found then raise exception using errcode='P0002',message='inventory_pack_unit_not_found'; end if;

    v_open:=greatest(v_line.ordered_quantity-v_line.received_quantity,0);
    v_good:=coalesce(v_input.good_pack_count,0)*v_pack.base_quantity;
    v_damaged:=coalesce(v_input.damaged_pack_count,0)*v_pack.base_quantity;
    v_missing:=coalesce(v_input.missing_pack_count,0)*v_pack.base_quantity;
    v_observed:=v_good+v_damaged+v_missing;
    if v_observed>v_open+0.000001 then
      raise exception using errcode='22023',message='inventory_purchase_order_quantity_exceeded';
    end if;

    if v_good>0 then
      v_line_no:=v_line_no+1;
      v_good_line_count:=v_good_line_count+1;
      insert into public.inventory_goods_receipt_lines(
        organization_id,receipt_id,line_no,item_id,pack_unit_id,pack_count,base_quantity
      ) values(
        p_organization_id,v_receipt_id,v_line_no,v_input.item_id,v_input.pack_unit_id,v_input.good_pack_count,v_good
      );

      update public.inventory_purchase_order_lines
         set received_quantity=received_quantity+v_good
       where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and item_id=v_input.item_id;

      v_move:=public.aora_inventory_apply_movement(
        p_organization_id,p_location_id,v_input.item_id,'receipt',v_good,'goods_receipt','goods_receipt',v_receipt_id::text,
        p_actor_id,p_actor_role,p_idempotency_key||':movement:'||v_input.item_id::text
      );
      perform public.aora_inventory_evaluate_replenishment(p_organization_id,p_location_id,v_input.item_id);

      if v_pack.is_stock_unit then
        v_print_job_id:=gen_random_uuid();
        insert into public.inventory_label_print_jobs(
          organization_id,id,location_id,receipt_id,purchase_order_id,item_id,pack_unit_id,label_count,created_by
        ) values(
          p_organization_id,v_print_job_id,p_location_id,v_receipt_id,p_purchase_order_id,
          v_input.item_id,v_input.pack_unit_id,v_input.good_pack_count,p_actor_id
        );
        v_print_jobs:=v_print_jobs||jsonb_build_array(v_print_job_id);
      end if;
    end if;

    if v_damaged>0 then
      v_exception_count:=v_exception_count+1;
      insert into public.inventory_receipt_exceptions(
        organization_id,receipt_id,purchase_order_id,location_id,item_id,pack_unit_id,
        exception_type,pack_count,base_quantity,note,created_by
      ) values(
        p_organization_id,v_receipt_id,p_purchase_order_id,p_location_id,v_input.item_id,v_input.pack_unit_id,
        'damaged',v_input.damaged_pack_count,v_damaged,nullif(left(trim(coalesce(v_input.note,'')),500),''),p_actor_id
      );
    end if;
    if v_missing>0 then
      v_exception_count:=v_exception_count+1;
      insert into public.inventory_receipt_exceptions(
        organization_id,receipt_id,purchase_order_id,location_id,item_id,pack_unit_id,
        exception_type,pack_count,base_quantity,note,created_by
      ) values(
        p_organization_id,v_receipt_id,p_purchase_order_id,p_location_id,v_input.item_id,v_input.pack_unit_id,
        'missing',v_input.missing_pack_count,v_missing,nullif(left(trim(coalesce(v_input.note,'')),500),''),p_actor_id
      );
    end if;
  end loop;

  if v_good_line_count=0 and v_exception_count=0 then
    raise exception using errcode='22023',message='inventory_receipt_lines_invalid';
  end if;

  if exists(
    select 1 from public.inventory_purchase_order_lines
     where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and received_quantity<ordered_quantity
  ) then v_status:='partially_received'; else v_status:='received'; end if;

  update public.inventory_purchase_orders
     set status=v_status,
         version=version+1,
         received_at=case when v_status='received' then clock_timestamp() else received_at end,
         updated_by=p_actor_id,
         updated_at=clock_timestamp()
   where organization_id=p_organization_id and id=p_purchase_order_id;

  update public.inventory_goods_receipts
     set status=case when v_exception_count>0 then 'received_with_exceptions' else 'received' end
   where organization_id=p_organization_id and id=v_receipt_id;

  v_result:=jsonb_build_object(
    'receiptId',v_receipt_id,
    'purchaseOrderId',p_purchase_order_id,
    'purchaseOrderStatus',v_status,
    'goodLineCount',v_good_line_count,
    'exceptionCount',v_exception_count,
    'printJobIds',v_print_jobs,
    'idempotent',false
  );

  insert into public.inventory_outbox(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(p_organization_id,'inventory.receipt.completed','goods_receipt',v_receipt_id::text,v_result);
  return v_result;
end $$;

revoke all on function public.aora_inventory_set_count_line_at(uuid,uuid,uuid,numeric,text,timestamptz) from public,anon,authenticated;
revoke all on function public.aora_inventory_set_count_line(uuid,uuid,uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_consume_stock_unit(uuid,text,uuid,numeric,text,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_consume_qr_unit(uuid,text,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_consume_qr_short_code(uuid,text,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_receive_purchase_order_delivery(uuid,text,uuid,jsonb,text,text,text) from public,anon,authenticated;

grant execute on function public.aora_inventory_set_count_line_at(uuid,uuid,uuid,numeric,text,timestamptz) to service_role;
grant execute on function public.aora_inventory_set_count_line(uuid,uuid,uuid,numeric,text) to service_role;
grant execute on function public.aora_inventory_consume_stock_unit(uuid,text,uuid,numeric,text,text,text,text) to service_role;
grant execute on function public.aora_inventory_consume_qr_unit(uuid,text,text,numeric,text,text,text) to service_role;
grant execute on function public.aora_inventory_consume_qr_short_code(uuid,text,text,numeric,text,text,text) to service_role;
grant execute on function public.aora_inventory_receive_purchase_order_delivery(uuid,text,uuid,jsonb,text,text,text) to service_role;

commit;
