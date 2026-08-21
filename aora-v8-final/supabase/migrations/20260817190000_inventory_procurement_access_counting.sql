begin;

create table if not exists public.inventory_ordering_profiles(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id text not null,
  cafe_name text not null default '', legal_name text not null default '', address text not null default '',
  postal_code text not null default '', city text not null default '', phone text not null default '',
  ordering_email text not null default '', reply_to_email text not null default '', whatsapp_number text not null default '',
  customer_number text not null default '', vat_id text not null default '', signature text not null default '',
  updated_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(organization_id,location_id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);

create table if not exists public.inventory_supplier_items(
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(), supplier_id uuid not null, item_id uuid not null, pack_unit_id uuid,
  supplier_sku text not null default '', supplier_item_name text not null default '',
  unit_price numeric(20,6) check(unit_price is null or unit_price>=0), currency text not null default 'EUR' check(length(currency)=3),
  minimum_order_quantity numeric(20,6) not null default 1 check(minimum_order_quantity>0),
  order_multiple numeric(20,6) not null default 1 check(order_multiple>0), active boolean not null default true,
  created_by text not null, updated_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(organization_id,id), unique(organization_id,supplier_id,item_id),
  foreign key(organization_id,supplier_id) references public.inventory_suppliers(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.inventory_items(organization_id,id) on delete restrict,
  foreign key(organization_id,pack_unit_id) references public.inventory_pack_units(organization_id,id) on delete restrict
);

create table if not exists public.inventory_purchase_order_deliveries(
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(), purchase_order_id uuid not null,
  channel text not null check(channel in('email','whatsapp','manual_email','manual_whatsapp')),
  status text not null check(status in('pending','sending','sent','delivered','read','failed','manual_required','confirmed_manual')),
  recipient text not null default '', sender_identity text not null default '', reply_to text not null default '', provider text not null default '',
  provider_message_id text, provider_status text, manual_link text, last_error text, attempts integer not null default 0 check(attempts>=0),
  idempotency_key text not null, created_by text not null, created_at timestamptz not null default now(), sent_at timestamptz, delivered_at timestamptz, read_at timestamptz,
  primary key(organization_id,id), unique(organization_id,idempotency_key),
  foreign key(organization_id,purchase_order_id) references public.inventory_purchase_orders(organization_id,id) on delete restrict
);

create table if not exists public.inventory_counts(
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(), location_id text not null,
  status text not null default 'draft' check(status in('draft','counting','review','posted','cancelled')),
  scope text not null default 'all', note text not null default '', version integer not null default 1 check(version>0),
  created_by text not null, posted_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), posted_at timestamptz,
  primary key(organization_id,id), foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete restrict
);

create table if not exists public.inventory_count_lines(
  organization_id uuid not null, count_id uuid not null, item_id uuid not null,
  system_quantity numeric(20,6) not null check(system_quantity>=0), counted_quantity numeric(20,6) check(counted_quantity is null or counted_quantity>=0),
  variance numeric(20,6) generated always as (case when counted_quantity is null then null else counted_quantity-system_quantity end) stored,
  updated_by text, updated_at timestamptz not null default now(),
  primary key(organization_id,count_id,item_id),
  foreign key(organization_id,count_id) references public.inventory_counts(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.inventory_items(organization_id,id) on delete restrict
);

alter table public.inventory_purchase_orders drop constraint if exists inventory_purchase_orders_status_check;
alter table public.inventory_purchase_orders add constraint inventory_purchase_orders_status_check
  check(status in('draft','ready','sending','submitted','placed','send_failed','delivered','partially_received','received','cancelled'));
alter table public.inventory_purchase_orders add column if not exists order_number text;
alter table public.inventory_purchase_orders add column if not exists delivery_channel text;
alter table public.inventory_purchase_orders add column if not exists approved_by text;
alter table public.inventory_purchase_orders add column if not exists sent_at timestamptz;
alter table public.inventory_purchase_orders add column if not exists supplier_contact_snapshot jsonb not null default '{}'::jsonb;
alter table public.inventory_purchase_orders add column if not exists location_contact_snapshot jsonb not null default '{}'::jsonb;
alter table public.inventory_purchase_orders add column if not exists provider_message_id text;
alter table public.inventory_purchase_orders add column if not exists provider_status text;
alter table public.inventory_purchase_orders add column if not exists last_error text;
alter table public.inventory_purchase_orders add column if not exists creation_idempotency_key text;

alter table public.inventory_purchase_order_lines add column if not exists supplier_item_id uuid;
alter table public.inventory_purchase_order_lines add column if not exists pack_unit_id uuid;
alter table public.inventory_purchase_order_lines add column if not exists ordered_pack_quantity numeric(20,6);
alter table public.inventory_purchase_order_lines add column if not exists supplier_sku text;
alter table public.inventory_purchase_order_lines add column if not exists supplier_item_name text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='inventory_po_lines_supplier_item_fk') then
    alter table public.inventory_purchase_order_lines add constraint inventory_po_lines_supplier_item_fk foreign key(organization_id,supplier_item_id) references public.inventory_supplier_items(organization_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='inventory_po_lines_pack_unit_fk') then
    alter table public.inventory_purchase_order_lines add constraint inventory_po_lines_pack_unit_fk foreign key(organization_id,pack_unit_id) references public.inventory_pack_units(organization_id,id) on delete restrict;
  end if;
end $$;

create unique index if not exists inventory_po_order_number_uidx on public.inventory_purchase_orders(organization_id,order_number) where order_number is not null;
create unique index if not exists inventory_po_creation_idem_uidx on public.inventory_purchase_orders(organization_id,creation_idempotency_key) where creation_idempotency_key is not null;
create index if not exists inventory_supplier_items_supplier_idx on public.inventory_supplier_items(organization_id,supplier_id,active,item_id);
create index if not exists inventory_supplier_items_item_idx on public.inventory_supplier_items(organization_id,item_id,active);
create index if not exists inventory_po_deliveries_order_idx on public.inventory_purchase_order_deliveries(organization_id,purchase_order_id,created_at desc);
create index if not exists inventory_counts_location_idx on public.inventory_counts(organization_id,location_id,status,created_at desc);
create index if not exists inventory_count_lines_item_idx on public.inventory_count_lines(organization_id,item_id);
create index if not exists inventory_po_lines_supplier_item_idx on public.inventory_purchase_order_lines(organization_id,supplier_item_id) where supplier_item_id is not null;
create index if not exists inventory_po_lines_pack_unit_idx on public.inventory_purchase_order_lines(organization_id,pack_unit_id) where pack_unit_id is not null;

alter table public.inventory_ordering_profiles enable row level security;
alter table public.inventory_supplier_items enable row level security;
alter table public.inventory_purchase_order_deliveries enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;
revoke all on table public.inventory_ordering_profiles,public.inventory_supplier_items,public.inventory_purchase_order_deliveries,public.inventory_counts,public.inventory_count_lines from public,anon,authenticated;
grant all on table public.inventory_ordering_profiles,public.inventory_supplier_items,public.inventory_purchase_order_deliveries,public.inventory_counts,public.inventory_count_lines to service_role;

create or replace function public.aora_inventory_set_manager_full_access(p_organization_id uuid,p_manager_id text,p_location_ids text[],p_actor_id text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_location text; v_permission text; v_added int:=0; v_removed int:=0;
begin
  perform 1 from public.admins where organization_id=p_organization_id and id=p_manager_id and deleted_at is null and coalesce(payload->>'scope','manager')='manager';
  if not found then raise exception using errcode='P0002',message='inventory_manager_not_found'; end if;
  if exists(select 1 from unnest(coalesce(p_location_ids,array[]::text[])) x where not exists(select 1 from public.manager_location_access m where m.organization_id=p_organization_id and m.manager_id=p_manager_id and m.location_id=x)) then
    raise exception using errcode='42501',message='inventory_manager_location_forbidden';
  end if;
  with deleted as (
    delete from public.inventory_permission_grants where organization_id=p_organization_id and subject_type='admin' and subject_id=p_manager_id returning location_id,permission
  ) insert into public.inventory_permission_events(organization_id,subject_type,subject_id,location_id,permission,action,actor_id,actor_role)
    select p_organization_id,'admin',p_manager_id,location_id,permission,'revoked',p_actor_id,'owner' from deleted;
  get diagnostics v_removed=row_count;
  foreach v_location in array coalesce(p_location_ids,array[]::text[]) loop
    foreach v_permission in array array['view','receipt','consume','waste','transfer_dispatch','transfer_receive','adjust','procurement'] loop
      insert into public.inventory_permission_grants(organization_id,subject_type,subject_id,location_id,permission,granted_by)
      values(p_organization_id,'admin',p_manager_id,v_location,v_permission,p_actor_id) on conflict do nothing;
      if found then
        v_added:=v_added+1;
        insert into public.inventory_permission_events(organization_id,subject_type,subject_id,location_id,permission,action,actor_id,actor_role)
        values(p_organization_id,'admin',p_manager_id,v_location,v_permission,'granted',p_actor_id,'owner');
      end if;
    end loop;
  end loop;
  return jsonb_build_object('managerId',p_manager_id,'locationIds',coalesce(to_jsonb(p_location_ids),'[]'::jsonb),'grantsAdded',v_added,'grantsRemoved',v_removed);
end $$;

create or replace function public.aora_inventory_create_purchase_order(
  p_organization_id uuid,p_location_id text,p_supplier_id uuid,p_lines jsonb,p_expected_on date,p_note text,p_actor_id text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_id uuid:=gen_random_uuid(); v_existing public.inventory_purchase_orders%rowtype; v_number text; v_count int;
begin
  if nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 180 then raise exception using errcode='22023',message='inventory_idempotency_invalid'; end if;
  select * into v_existing from public.inventory_purchase_orders where organization_id=p_organization_id and creation_idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('purchaseOrderId',v_existing.id,'orderNumber',v_existing.order_number,'status',v_existing.status,'version',v_existing.version,'idempotent',true); end if;
  perform 1 from public.locations where organization_id=p_organization_id and id=p_location_id and active=true and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='inventory_location_not_found'; end if;
  perform 1 from public.inventory_suppliers where organization_id=p_organization_id and id=p_supplier_id and active=true;
  if not found then raise exception using errcode='P0002',message='inventory_supplier_not_found'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception using errcode='22023',message='inventory_po_lines_invalid'; end if;
  v_number:='AORA-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,6));
  insert into public.inventory_purchase_orders(organization_id,id,supplier_id,location_id,status,expected_on,note,order_number,creation_idempotency_key,created_by,updated_by)
  values(p_organization_id,v_id,p_supplier_id,p_location_id,'draft',p_expected_on,nullif(left(trim(coalesce(p_note,'')),1000),''),v_number,p_idempotency_key,p_actor_id,p_actor_id);
  insert into public.inventory_purchase_order_lines(organization_id,purchase_order_id,item_id,ordered_quantity,unit_cost,supplier_item_id,pack_unit_id,ordered_pack_quantity,supplier_sku,supplier_item_name)
  select p_organization_id,v_id,x.item_id,x.ordered_quantity,x.unit_cost,x.supplier_item_id,x.pack_unit_id,x.ordered_pack_quantity,left(coalesce(x.supplier_sku,''),120),left(coalesce(x.supplier_item_name,''),180)
  from jsonb_to_recordset(p_lines) x(item_id uuid,ordered_quantity numeric,unit_cost numeric,supplier_item_id uuid,pack_unit_id uuid,ordered_pack_quantity numeric,supplier_sku text,supplier_item_name text)
  where x.item_id is not null and x.ordered_quantity>0 and x.ordered_quantity<=1000000000 and x.ordered_pack_quantity>0;
  get diagnostics v_count=row_count;
  if v_count<>jsonb_array_length(p_lines) then raise exception using errcode='22023',message='inventory_po_lines_invalid'; end if;
  return jsonb_build_object('purchaseOrderId',v_id,'orderNumber',v_number,'status','draft','version',1,'idempotent',false);
exception when unique_violation then
  select * into v_existing from public.inventory_purchase_orders where organization_id=p_organization_id and creation_idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('purchaseOrderId',v_existing.id,'orderNumber',v_existing.order_number,'status',v_existing.status,'version',v_existing.version,'idempotent',true); end if;
  raise;
end $$;

create or replace function public.aora_inventory_start_count(p_organization_id uuid,p_location_id text,p_scope text,p_actor_id text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_id uuid:=gen_random_uuid(); v_rows int;
begin
  perform 1 from public.locations where organization_id=p_organization_id and id=p_location_id and active=true and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='inventory_location_not_found'; end if;
  insert into public.inventory_counts(organization_id,id,location_id,status,scope,created_by) values(p_organization_id,v_id,p_location_id,'counting',left(coalesce(nullif(trim(p_scope),''),'all'),80),p_actor_id);
  insert into public.inventory_count_lines(organization_id,count_id,item_id,system_quantity)
  select organization_id,v_id,item_id,on_hand from public.inventory_balances where organization_id=p_organization_id and location_id=p_location_id order by item_id;
  get diagnostics v_rows=row_count;
  return jsonb_build_object('countId',v_id,'status','counting','lineCount',v_rows,'version',1);
end $$;

create or replace function public.aora_inventory_post_count(p_organization_id uuid,p_count_id uuid,p_actor_id text,p_actor_role text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_count public.inventory_counts%rowtype; v_line record; v_result jsonb; v_posted int:=0;
begin
  if p_actor_role not in('owner','manager') then raise exception using errcode='42501',message='inventory_count_actor_forbidden'; end if;
  select * into v_count from public.inventory_counts where organization_id=p_organization_id and id=p_count_id for update;
  if not found then raise exception using errcode='P0002',message='inventory_count_not_found'; end if;
  if v_count.status='posted' then return jsonb_build_object('countId',p_count_id,'status','posted','idempotent',true); end if;
  if v_count.status not in('counting','review') or v_count.version<>p_expected_version then raise exception using errcode='40001',message='inventory_count_conflict'; end if;
  if exists(select 1 from public.inventory_count_lines where organization_id=p_organization_id and count_id=p_count_id and counted_quantity is null) then raise exception using errcode='22023',message='inventory_count_incomplete'; end if;
  for v_line in select * from public.inventory_count_lines where organization_id=p_organization_id and count_id=p_count_id order by item_id loop
    if v_line.variance<>0 then
      v_result:=public.aora_inventory_apply_movement(p_organization_id,v_count.location_id,v_line.item_id,case when v_line.variance>0 then 'adjustment_in' else 'adjustment_out' end,abs(v_line.variance),'inventory_count','inventory_count',p_count_id::text,p_actor_id,p_actor_role,'inventory-count:'||p_count_id::text||':'||v_line.item_id::text);
      v_posted:=v_posted+1;
    end if;
  end loop;
  update public.inventory_counts set status='posted',version=version+1,posted_by=p_actor_id,posted_at=clock_timestamp(),updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_count_id;
  return jsonb_build_object('countId',p_count_id,'status','posted','adjustments',v_posted,'version',v_count.version+1,'idempotent',false);
end $$;

create or replace function public.aora_inventory_receive_purchase_order_line(
  p_organization_id uuid,p_location_id text,p_purchase_order_id uuid,p_item_id uuid,p_pack_unit_id uuid,p_pack_count integer,p_actor_id text,p_actor_role text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_order public.inventory_purchase_orders%rowtype; v_line public.inventory_purchase_order_lines%rowtype; v_pack public.inventory_pack_units%rowtype; v_qty numeric; v_receipt uuid:=gen_random_uuid(); v_status text; v_move jsonb;
begin
  if p_actor_role not in('owner','manager') or p_pack_count<1 or p_pack_count>10000 then raise exception using errcode='22023',message='inventory_receipt_invalid'; end if;
  if exists(select 1 from public.inventory_goods_receipts where organization_id=p_organization_id and idempotency_key=p_idempotency_key) then return jsonb_build_object('idempotent',true); end if;
  select * into v_order from public.inventory_purchase_orders where organization_id=p_organization_id and id=p_purchase_order_id and location_id=p_location_id and status in('submitted','placed','delivered','partially_received') for update;
  if not found then raise exception using errcode='P0001',message='inventory_purchase_order_not_receivable'; end if;
  select * into v_line from public.inventory_purchase_order_lines where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and item_id=p_item_id for update;
  if not found then raise exception using errcode='P0002',message='inventory_purchase_order_line_not_found'; end if;
  select * into v_pack from public.inventory_pack_units where organization_id=p_organization_id and id=p_pack_unit_id and item_id=p_item_id and active=true;
  if not found then raise exception using errcode='P0002',message='inventory_pack_unit_not_found'; end if;
  v_qty:=v_pack.base_quantity*p_pack_count;
  if v_line.received_quantity+v_qty>v_line.ordered_quantity then raise exception using errcode='22023',message='inventory_purchase_order_quantity_exceeded'; end if;
  insert into public.inventory_goods_receipts(organization_id,id,location_id,purchase_order_id,idempotency_key,received_by) values(p_organization_id,v_receipt,p_location_id,p_purchase_order_id,p_idempotency_key,p_actor_id);
  insert into public.inventory_goods_receipt_lines(organization_id,receipt_id,line_no,item_id,pack_unit_id,pack_count,base_quantity) values(p_organization_id,v_receipt,1,p_item_id,p_pack_unit_id,p_pack_count,v_qty);
  update public.inventory_purchase_order_lines set received_quantity=received_quantity+v_qty where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and item_id=p_item_id;
  v_move:=public.aora_inventory_apply_movement(p_organization_id,p_location_id,p_item_id,'receipt',v_qty,'goods_receipt','goods_receipt',v_receipt::text,p_actor_id,p_actor_role,p_idempotency_key||':movement');
  if exists(select 1 from public.inventory_purchase_order_lines where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and received_quantity<ordered_quantity) then v_status:='partially_received'; else v_status:='received'; end if;
  update public.inventory_purchase_orders set status=v_status,version=version+1,received_at=case when v_status='received' then clock_timestamp() else received_at end,updated_by=p_actor_id,updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_purchase_order_id;
  return v_move||jsonb_build_object('receiptId',v_receipt,'purchaseOrderId',p_purchase_order_id,'purchaseOrderStatus',v_status,'packCount',p_pack_count);
end $$;

create or replace function public.aora_inventory_issue_qr_short_code(
  p_organization_id uuid,p_location_id text,p_short_code text,p_actor_id text,p_actor_role text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_existing jsonb; v_unit public.inventory_stock_units%rowtype; v_balance public.inventory_balances%rowtype; v_movement_id uuid:=gen_random_uuid(); v_result jsonb;
begin
  select result_snapshot into v_existing from public.inventory_movements where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return v_existing||jsonb_build_object('idempotent',true); end if;
  update public.inventory_stock_units set status='issued',issued_by=p_actor_id,issued_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
  where organization_id=p_organization_id and location_id=p_location_id and upper(short_code)=upper(trim(p_short_code)) and status='available' returning * into v_unit;
  if not found then
    if exists(select 1 from public.inventory_stock_units where organization_id=p_organization_id and upper(short_code)=upper(trim(p_short_code))) then raise exception using errcode='P0001',message='inventory_qr_already_used_or_wrong_location'; end if;
    raise exception using errcode='P0002',message='inventory_qr_not_found';
  end if;
  select * into strict v_balance from public.inventory_balances where organization_id=p_organization_id and location_id=p_location_id and item_id=v_unit.item_id for update;
  if v_balance.on_hand<v_unit.base_quantity then raise exception using errcode='P0001',message='inventory_balance_invariant_failed'; end if;
  v_result:=jsonb_build_object('movementId',v_movement_id,'stockUnitId',v_unit.id,'itemId',v_unit.item_id,'quantityDelta',-v_unit.base_quantity,'onHand',v_balance.on_hand-v_unit.base_quantity,'idempotent',false);
  insert into public.inventory_movements(organization_id,id,location_id,item_id,stock_unit_id,movement_type,quantity_delta,reference_type,reference_id,actor_id,actor_role,idempotency_key,result_snapshot)
  values(p_organization_id,v_movement_id,p_location_id,v_unit.item_id,v_unit.id,'consumption',-v_unit.base_quantity,'qr_short_code',v_unit.id::text,p_actor_id,p_actor_role,p_idempotency_key,v_result);
  update public.inventory_balances set on_hand=on_hand-v_unit.base_quantity,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and location_id=p_location_id and item_id=v_unit.item_id;
  perform public.aora_inventory_evaluate_replenishment(p_organization_id,p_location_id,v_unit.item_id);
  return v_result;
end $$;

create or replace function public.aora_inventory_evaluate_replenishment(p_organization_id uuid,p_location_id text,p_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_balance public.inventory_balances%rowtype; v_policy public.inventory_item_locations%rowtype; v_incoming numeric(20,6):=0; v_effective numeric(20,6); v_need numeric(20,6):=0; v_state public.inventory_replenishment_state%rowtype; v_episode uuid;
begin
  select * into strict v_balance from public.inventory_balances where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id;
  select * into strict v_policy from public.inventory_item_locations where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id;
  select coalesce(sum(greatest(l.ordered_quantity-l.received_quantity,0)),0) into v_incoming from public.inventory_purchase_order_lines l join public.inventory_purchase_orders p on p.organization_id=l.organization_id and p.id=l.purchase_order_id where l.organization_id=p_organization_id and l.item_id=p_item_id and p.location_id=p_location_id and p.status in('submitted','placed','delivered','partially_received');
  v_effective:=v_balance.on_hand+v_balance.in_transit_in+v_incoming-v_balance.reserved;
  if v_effective<=v_policy.reorder_point then
    v_need:=greatest(coalesce(v_policy.par_level,v_policy.maximum_level,v_policy.reorder_point)-v_effective,0);
    select * into v_state from public.inventory_replenishment_state where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id for update;
    v_episode:=case when found and v_state.below_threshold then v_state.episode_id else gen_random_uuid() end;
    insert into public.inventory_replenishment_state(organization_id,location_id,item_id,below_threshold,episode_id,opened_at,closed_at,suggested_base_quantity) values(p_organization_id,p_location_id,p_item_id,true,v_episode,clock_timestamp(),null,v_need)
    on conflict(organization_id,location_id,item_id) do update set below_threshold=true,episode_id=v_episode,opened_at=case when public.inventory_replenishment_state.below_threshold then public.inventory_replenishment_state.opened_at else clock_timestamp() end,closed_at=null,suggested_base_quantity=v_need,updated_at=clock_timestamp();
  else
    insert into public.inventory_replenishment_state(organization_id,location_id,item_id,below_threshold,suggested_base_quantity,closed_at) values(p_organization_id,p_location_id,p_item_id,false,0,clock_timestamp())
    on conflict(organization_id,location_id,item_id) do update set below_threshold=false,closed_at=case when public.inventory_replenishment_state.below_threshold then clock_timestamp() else public.inventory_replenishment_state.closed_at end,suggested_base_quantity=0,updated_at=clock_timestamp();
    v_episode:=null;
  end if;
  return jsonb_build_object('effectiveStock',v_effective,'incoming',v_incoming,'suggestedQuantity',v_need,'belowThreshold',v_effective<=v_policy.reorder_point,'episodeId',v_episode);
end $$;

revoke all on function public.aora_inventory_set_manager_full_access(uuid,text,text[],text) from public,anon,authenticated;
revoke all on function public.aora_inventory_create_purchase_order(uuid,text,uuid,jsonb,date,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_start_count(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_post_count(uuid,uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.aora_inventory_receive_purchase_order_line(uuid,text,uuid,uuid,uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_issue_qr_short_code(uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_evaluate_replenishment(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.aora_inventory_set_manager_full_access(uuid,text,text[],text) to service_role;
grant execute on function public.aora_inventory_create_purchase_order(uuid,text,uuid,jsonb,date,text,text,text) to service_role;
grant execute on function public.aora_inventory_start_count(uuid,text,text,text) to service_role;
grant execute on function public.aora_inventory_post_count(uuid,uuid,text,text,integer) to service_role;
grant execute on function public.aora_inventory_receive_purchase_order_line(uuid,text,uuid,uuid,uuid,integer,text,text,text) to service_role;
grant execute on function public.aora_inventory_issue_qr_short_code(uuid,text,text,text,text,text) to service_role;
grant execute on function public.aora_inventory_evaluate_replenishment(uuid,text,uuid) to service_role;

insert into public.feature_flags(organization_id,flag_key,enabled,config)
select o.id,f.key,false,jsonb_build_object('rollout','off','schemaVersion',2)
from public.organizations o cross join(values('supplier_whatsapp'),('inventory_counting')) f(key)
on conflict(organization_id,location_id,flag_key) do nothing;

commit;
