-- Phase 2 remains completely dormant until the corresponding feature flags
-- are enabled for one explicitly selected organization/location.
create table if not exists public.inventory_pack_units(
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  code text not null,
  label text not null,
  base_quantity numeric(20,6) not null check(base_quantity>0),
  is_stock_unit boolean not null default false,
  is_order_unit boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,id),
  unique(organization_id,item_id,code),
  foreign key(organization_id,item_id) references public.inventory_items(organization_id,id) on delete restrict
);

create table if not exists public.inventory_goods_receipts(
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  location_id text not null,
  purchase_order_id uuid,
  status text not null default 'received' check(status in('received','reversed')),
  idempotency_key text not null,
  received_by text not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key(organization_id,id),
  unique(organization_id,idempotency_key),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete restrict,
  foreign key(organization_id,purchase_order_id) references public.inventory_purchase_orders(organization_id,id) on delete restrict
);

create table if not exists public.inventory_goods_receipt_lines(
  organization_id uuid not null,
  receipt_id uuid not null,
  line_no integer not null check(line_no>0),
  item_id uuid not null,
  pack_unit_id uuid not null,
  pack_count integer not null check(pack_count>0 and pack_count<=10000),
  base_quantity numeric(20,6) not null check(base_quantity>0),
  primary key(organization_id,receipt_id,line_no),
  foreign key(organization_id,receipt_id) references public.inventory_goods_receipts(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.inventory_items(organization_id,id) on delete restrict,
  foreign key(organization_id,pack_unit_id) references public.inventory_pack_units(organization_id,id) on delete restrict
);

create table if not exists public.inventory_stock_units(
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  location_id text not null,
  item_id uuid not null,
  pack_unit_id uuid not null,
  receipt_id uuid not null,
  token_hash bytea not null,
  short_code text not null,
  status text not null default 'available' check(status in('available','issued','waste','revoked')),
  base_quantity numeric(20,6) not null check(base_quantity>0),
  issued_by text,
  issued_at timestamptz,
  version bigint not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,id),
  unique(organization_id,token_hash),
  unique(organization_id,short_code),
  foreign key(organization_id,location_id,item_id) references public.inventory_item_locations(organization_id,location_id,item_id) on delete restrict,
  foreign key(organization_id,pack_unit_id) references public.inventory_pack_units(organization_id,id) on delete restrict,
  foreign key(organization_id,receipt_id) references public.inventory_goods_receipts(organization_id,id) on delete restrict
);

create table if not exists public.inventory_replenishment_state(
  organization_id uuid not null,
  location_id text not null,
  item_id uuid not null,
  below_threshold boolean not null default false,
  episode_id uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  suggested_base_quantity numeric(20,6) not null default 0 check(suggested_base_quantity>=0),
  updated_at timestamptz not null default now(),
  primary key(organization_id,location_id,item_id),
  foreign key(organization_id,location_id,item_id) references public.inventory_item_locations(organization_id,location_id,item_id) on delete restrict
);

alter table public.inventory_movements add column if not exists stock_unit_id uuid;
create unique index if not exists inventory_movements_stock_unit_issue_uidx
  on public.inventory_movements(organization_id,stock_unit_id)
  where stock_unit_id is not null and movement_type in('consumption','waste');
create index if not exists inventory_stock_units_available_idx
  on public.inventory_stock_units(organization_id,location_id,item_id,status,created_at)
  where status='available';

alter table public.inventory_pack_units enable row level security;
alter table public.inventory_goods_receipts enable row level security;
alter table public.inventory_goods_receipt_lines enable row level security;
alter table public.inventory_stock_units enable row level security;
alter table public.inventory_replenishment_state enable row level security;
revoke all on table public.inventory_pack_units,public.inventory_goods_receipts,
  public.inventory_goods_receipt_lines,public.inventory_stock_units,public.inventory_replenishment_state
  from public,anon,authenticated;
grant all on table public.inventory_pack_units,public.inventory_goods_receipts,
  public.inventory_goods_receipt_lines,public.inventory_stock_units,public.inventory_replenishment_state
  to service_role;

create or replace function public.aora_inventory_evaluate_replenishment(
  p_organization_id uuid,p_location_id text,p_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_balance public.inventory_balances%rowtype;
  v_policy public.inventory_item_locations%rowtype;
  v_incoming numeric(20,6):=0;
  v_effective numeric(20,6);
  v_need numeric(20,6):=0;
  v_state public.inventory_replenishment_state%rowtype;
  v_episode uuid;
begin
  select * into strict v_balance from public.inventory_balances
    where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id;
  select * into strict v_policy from public.inventory_item_locations
    where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id;
  select coalesce(sum(greatest(l.ordered_quantity-l.received_quantity,0)),0) into v_incoming
    from public.inventory_purchase_order_lines l
    join public.inventory_purchase_orders p on p.organization_id=l.organization_id and p.id=l.purchase_order_id
    where l.organization_id=p_organization_id and l.item_id=p_item_id and p.location_id=p_location_id
      and p.status in('submitted','partially_received');
  v_effective:=v_balance.on_hand+v_balance.in_transit_in+v_incoming-v_balance.reserved;
  if v_effective<=v_policy.reorder_point then
    v_need:=greatest(coalesce(v_policy.par_level,v_policy.maximum_level,v_policy.reorder_point)-v_effective,0);
    select * into v_state from public.inventory_replenishment_state
      where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id for update;
    v_episode:=case when found and v_state.below_threshold then v_state.episode_id else gen_random_uuid() end;
    insert into public.inventory_replenishment_state(organization_id,location_id,item_id,below_threshold,episode_id,opened_at,closed_at,suggested_base_quantity)
    values(p_organization_id,p_location_id,p_item_id,true,v_episode,clock_timestamp(),null,v_need)
    on conflict(organization_id,location_id,item_id) do update set
      below_threshold=true,episode_id=v_episode,
      opened_at=case when public.inventory_replenishment_state.below_threshold then public.inventory_replenishment_state.opened_at else clock_timestamp() end,
      closed_at=null,suggested_base_quantity=v_need,updated_at=clock_timestamp();
  else
    insert into public.inventory_replenishment_state(organization_id,location_id,item_id,below_threshold,suggested_base_quantity,closed_at)
    values(p_organization_id,p_location_id,p_item_id,false,0,clock_timestamp())
    on conflict(organization_id,location_id,item_id) do update set
      below_threshold=false,closed_at=case when public.inventory_replenishment_state.below_threshold then clock_timestamp() else public.inventory_replenishment_state.closed_at end,
      suggested_base_quantity=0,updated_at=clock_timestamp();
    v_episode:=null;
  end if;
  return jsonb_build_object('effectiveStock',v_effective,'incoming',v_incoming,'suggestedQuantity',v_need,'belowThreshold',v_effective<=v_policy.reorder_point,'episodeId',v_episode);
end $$;

create or replace function public.aora_inventory_receive_qr_units(
  p_organization_id uuid,p_location_id text,p_item_id uuid,p_pack_unit_id uuid,
  p_units jsonb,p_actor_id text,p_idempotency_key text,p_purchase_order_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_receipt_id uuid:=gen_random_uuid();
  v_existing uuid;
  v_pack public.inventory_pack_units%rowtype;
  v_count integer;
  v_total numeric(20,6);
  v_balance public.inventory_balances%rowtype;
  v_result jsonb;
begin
  if jsonb_typeof(p_units)<>'array' or jsonb_array_length(p_units)=0 or jsonb_array_length(p_units)>1000 then
    raise exception using errcode='22023',message='inventory_qr_units_invalid';
  end if;
  select id into v_existing from public.inventory_goods_receipts where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('receiptId',v_existing,'idempotent',true); end if;
  select * into strict v_pack from public.inventory_pack_units
    where organization_id=p_organization_id and id=p_pack_unit_id and item_id=p_item_id and active=true and is_stock_unit=true;
  perform 1 from public.inventory_item_locations where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id and active=true;
  if not found then raise exception using errcode='P0002',message='inventory_item_location_not_found'; end if;
  insert into public.inventory_goods_receipts(organization_id,id,location_id,purchase_order_id,idempotency_key,received_by)
    values(p_organization_id,v_receipt_id,p_location_id,p_purchase_order_id,p_idempotency_key,p_actor_id);
  insert into public.inventory_goods_receipt_lines(organization_id,receipt_id,line_no,item_id,pack_unit_id,pack_count,base_quantity)
    values(p_organization_id,v_receipt_id,1,p_item_id,p_pack_unit_id,jsonb_array_length(p_units),v_pack.base_quantity*jsonb_array_length(p_units));
  insert into public.inventory_stock_units(organization_id,location_id,item_id,pack_unit_id,receipt_id,token_hash,short_code,base_quantity)
    select p_organization_id,p_location_id,p_item_id,p_pack_unit_id,v_receipt_id,
      decode(u.token_hash,'hex'),upper(u.short_code),v_pack.base_quantity
    from jsonb_to_recordset(p_units) as u(token_hash text,short_code text)
    where u.token_hash~'^[0-9a-f]{64}$' and u.short_code~'^[A-Za-z0-9-]{6,20}$';
  get diagnostics v_count=row_count;
  if v_count<>jsonb_array_length(p_units) then raise exception using errcode='22023',message='inventory_qr_units_invalid'; end if;
  v_total:=v_pack.base_quantity*v_count;
  insert into public.inventory_balances(organization_id,location_id,item_id) values(p_organization_id,p_location_id,p_item_id) on conflict do nothing;
  select * into strict v_balance from public.inventory_balances
    where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id for update;
  v_result:=jsonb_build_object('receiptId',v_receipt_id,'itemId',p_item_id,'unitCount',v_count,'quantityDelta',v_total,'onHand',v_balance.on_hand+v_total,'idempotent',false);
  insert into public.inventory_movements(organization_id,location_id,item_id,movement_type,quantity_delta,reference_type,reference_id,actor_id,actor_role,idempotency_key,result_snapshot)
    values(p_organization_id,p_location_id,p_item_id,'receipt',v_total,'goods_receipt',v_receipt_id::text,p_actor_id,'manager',p_idempotency_key||':movement',v_result);
  update public.inventory_balances set on_hand=on_hand+v_total,version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id;
  perform public.aora_inventory_evaluate_replenishment(p_organization_id,p_location_id,p_item_id);
  return v_result;
exception when unique_violation then
  raise exception using errcode='23505',message='inventory_qr_duplicate';
end $$;

create or replace function public.aora_inventory_issue_qr_unit(
  p_organization_id uuid,p_location_id text,p_token_hash_hex text,p_actor_id text,p_actor_role text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_existing jsonb;
  v_unit public.inventory_stock_units%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_movement_id uuid:=gen_random_uuid();
  v_result jsonb;
begin
  select result_snapshot into v_existing from public.inventory_movements
    where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return v_existing||jsonb_build_object('idempotent',true); end if;
  update public.inventory_stock_units set status='issued',issued_by=p_actor_id,issued_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and location_id=p_location_id and token_hash=decode(p_token_hash_hex,'hex') and status='available'
    returning * into v_unit;
  if not found then
    if exists(select 1 from public.inventory_stock_units where organization_id=p_organization_id and token_hash=decode(p_token_hash_hex,'hex')) then
      raise exception using errcode='P0001',message='inventory_qr_already_used_or_wrong_location';
    end if;
    raise exception using errcode='P0002',message='inventory_qr_not_found';
  end if;
  select * into strict v_balance from public.inventory_balances
    where organization_id=p_organization_id and location_id=p_location_id and item_id=v_unit.item_id for update;
  if v_balance.on_hand<v_unit.base_quantity then raise exception using errcode='P0001',message='inventory_balance_invariant_failed'; end if;
  v_result:=jsonb_build_object('movementId',v_movement_id,'stockUnitId',v_unit.id,'itemId',v_unit.item_id,'quantityDelta',-v_unit.base_quantity,'onHand',v_balance.on_hand-v_unit.base_quantity,'idempotent',false);
  insert into public.inventory_movements(organization_id,id,location_id,item_id,stock_unit_id,movement_type,quantity_delta,reference_type,reference_id,actor_id,actor_role,idempotency_key,result_snapshot)
    values(p_organization_id,v_movement_id,p_location_id,v_unit.item_id,v_unit.id,'consumption',-v_unit.base_quantity,'qr_scan',v_unit.id::text,p_actor_id,p_actor_role,p_idempotency_key,v_result);
  update public.inventory_balances set on_hand=on_hand-v_unit.base_quantity,version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and location_id=p_location_id and item_id=v_unit.item_id;
  perform public.aora_inventory_evaluate_replenishment(p_organization_id,p_location_id,v_unit.item_id);
  return v_result;
end $$;

revoke all on function public.aora_inventory_evaluate_replenishment(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.aora_inventory_receive_qr_units(uuid,text,uuid,uuid,jsonb,text,text,uuid) from public,anon,authenticated;
revoke all on function public.aora_inventory_issue_qr_unit(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_evaluate_replenishment(uuid,text,uuid) to service_role;
grant execute on function public.aora_inventory_receive_qr_units(uuid,text,uuid,uuid,jsonb,text,text,uuid) to service_role;
grant execute on function public.aora_inventory_issue_qr_unit(uuid,text,text,text,text,text) to service_role;

insert into public.feature_flags(organization_id,flag_key,enabled,config)
select o.id,f.key,false,jsonb_build_object('rollout','off','schemaVersion',1)
from public.organizations o cross join(values('inventory_qr'),('inventory_printing'),('replenishment_suggestions'),('supplier_email')) as f(key)
on conflict(organization_id,location_id,flag_key) do nothing;
