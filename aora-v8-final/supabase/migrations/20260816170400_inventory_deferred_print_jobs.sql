begin;

create table if not exists public.inventory_label_print_jobs (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  location_id text not null,
  receipt_id uuid not null,
  purchase_order_id uuid,
  item_id uuid not null,
  pack_unit_id uuid not null,
  label_count integer not null check(label_count between 1 and 1000),
  status text not null default 'pending' check(status in('pending','prepared','printed')),
  generation integer not null default 0 check(generation>=0),
  prepared_at timestamptz,
  printed_at timestamptz,
  printed_by text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,id),
  unique(organization_id,receipt_id,item_id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete restrict,
  foreign key(organization_id,receipt_id) references public.inventory_goods_receipts(organization_id,id) on delete restrict,
  foreign key(organization_id,purchase_order_id) references public.inventory_purchase_orders(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.inventory_items(organization_id,id) on delete restrict,
  foreign key(organization_id,pack_unit_id) references public.inventory_pack_units(organization_id,id) on delete restrict
);

alter table public.inventory_stock_units add column if not exists print_job_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='inventory_stock_units_print_job_fk') then
    alter table public.inventory_stock_units add constraint inventory_stock_units_print_job_fk
      foreign key(organization_id,print_job_id)
      references public.inventory_label_print_jobs(organization_id,id) on delete restrict;
  end if;
end $$;

create index if not exists inventory_label_print_jobs_pending_idx
  on public.inventory_label_print_jobs(organization_id,location_id,status,created_at desc)
  where status in('pending','prepared');
create index if not exists inventory_label_print_jobs_receipt_idx
  on public.inventory_label_print_jobs(organization_id,receipt_id);
create index if not exists inventory_stock_units_print_job_idx
  on public.inventory_stock_units(organization_id,print_job_id,status)
  where print_job_id is not null;

alter table public.inventory_label_print_jobs enable row level security;
revoke all on table public.inventory_label_print_jobs from public,anon,authenticated;
grant all on table public.inventory_label_print_jobs to service_role;

create or replace function public.aora_inventory_receive_pending_labels(
  p_organization_id uuid,p_location_id text,p_item_id uuid,p_pack_unit_id uuid,
  p_count integer,p_actor_id text,p_actor_role text,p_idempotency_key text,
  p_purchase_order_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_receipt_id uuid:=gen_random_uuid();
  v_print_job_id uuid:=gen_random_uuid();
  v_existing_receipt uuid;
  v_existing_job uuid;
  v_pack public.inventory_pack_units%rowtype;
  v_order public.inventory_purchase_orders%rowtype;
  v_line public.inventory_purchase_order_lines%rowtype;
  v_total numeric(20,6);
  v_balance public.inventory_balances%rowtype;
  v_result jsonb;
  v_order_status text:=null;
begin
  if p_count is null or p_count<1 or p_count>1000 then
    raise exception using errcode='22023',message='inventory_label_count_invalid';
  end if;
  if p_actor_role not in('owner','manager') then
    raise exception using errcode='42501',message='inventory_receipt_actor_forbidden';
  end if;
  select r.id,j.id into v_existing_receipt,v_existing_job
    from public.inventory_goods_receipts r
    left join public.inventory_label_print_jobs j on j.organization_id=r.organization_id and j.receipt_id=r.id
    where r.organization_id=p_organization_id and r.idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('receiptId',v_existing_receipt,'printJobId',v_existing_job,'idempotent',true);
  end if;

  select * into strict v_pack from public.inventory_pack_units
    where organization_id=p_organization_id and id=p_pack_unit_id and item_id=p_item_id and active=true and is_stock_unit=true;
  perform 1 from public.inventory_item_locations
    where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id and active=true;
  if not found then raise exception using errcode='P0002',message='inventory_item_location_not_found'; end if;
  v_total:=v_pack.base_quantity*p_count;

  if p_purchase_order_id is not null then
    select * into v_order from public.inventory_purchase_orders
      where organization_id=p_organization_id and id=p_purchase_order_id and location_id=p_location_id
        and status in('submitted','partially_received') for update;
    if not found then raise exception using errcode='P0001',message='inventory_purchase_order_not_receivable'; end if;
    select * into v_line from public.inventory_purchase_order_lines
      where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and item_id=p_item_id for update;
    if not found then raise exception using errcode='P0002',message='inventory_purchase_order_line_not_found'; end if;
    if v_line.received_quantity+v_total>v_line.ordered_quantity then
      raise exception using errcode='22023',message='inventory_purchase_order_quantity_exceeded';
    end if;
  end if;

  insert into public.inventory_goods_receipts(organization_id,id,location_id,purchase_order_id,idempotency_key,received_by)
    values(p_organization_id,v_receipt_id,p_location_id,p_purchase_order_id,p_idempotency_key,p_actor_id);
  insert into public.inventory_goods_receipt_lines(organization_id,receipt_id,line_no,item_id,pack_unit_id,pack_count,base_quantity)
    values(p_organization_id,v_receipt_id,1,p_item_id,p_pack_unit_id,p_count,v_total);
  insert into public.inventory_label_print_jobs(
    organization_id,id,location_id,receipt_id,purchase_order_id,item_id,pack_unit_id,label_count,created_by
  ) values(
    p_organization_id,v_print_job_id,p_location_id,v_receipt_id,p_purchase_order_id,p_item_id,p_pack_unit_id,p_count,p_actor_id
  );

  if p_purchase_order_id is not null then
    update public.inventory_purchase_order_lines set received_quantity=received_quantity+v_total
      where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and item_id=p_item_id;
    if exists(
      select 1 from public.inventory_purchase_order_lines
      where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id and received_quantity<ordered_quantity
    ) then v_order_status:='partially_received'; else v_order_status:='received'; end if;
    update public.inventory_purchase_orders set status=v_order_status,version=version+1,updated_by=p_actor_id,
      received_at=case when v_order_status='received' then clock_timestamp() else null end,updated_at=clock_timestamp()
      where organization_id=p_organization_id and id=p_purchase_order_id;
  end if;

  insert into public.inventory_balances(organization_id,location_id,item_id)
    values(p_organization_id,p_location_id,p_item_id) on conflict do nothing;
  select * into strict v_balance from public.inventory_balances
    where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id for update;
  v_result:=jsonb_build_object(
    'receiptId',v_receipt_id,'printJobId',v_print_job_id,'printJobStatus','pending',
    'itemId',p_item_id,'unitCount',p_count,'quantityDelta',v_total,
    'onHand',v_balance.on_hand+v_total,'idempotent',false,
    'purchaseOrderId',p_purchase_order_id,'purchaseOrderStatus',v_order_status
  );
  insert into public.inventory_movements(
    organization_id,location_id,item_id,movement_type,quantity_delta,reference_type,reference_id,
    actor_id,actor_role,idempotency_key,result_snapshot
  ) values(
    p_organization_id,p_location_id,p_item_id,'receipt',v_total,'goods_receipt',v_receipt_id::text,
    p_actor_id,p_actor_role,p_idempotency_key||':movement',v_result
  );
  update public.inventory_balances set on_hand=on_hand+v_total,version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id;
  perform public.aora_inventory_evaluate_replenishment(p_organization_id,p_location_id,p_item_id);
  return v_result;
end $$;

create or replace function public.aora_inventory_prepare_print_job(
  p_organization_id uuid,p_location_id text,p_print_job_id uuid,p_units jsonb,p_actor_id text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_job public.inventory_label_print_jobs%rowtype;
  v_pack public.inventory_pack_units%rowtype;
  v_count integer;
begin
  if jsonb_typeof(p_units)<>'array' or jsonb_array_length(p_units)=0 or jsonb_array_length(p_units)>1000 then
    raise exception using errcode='22023',message='inventory_qr_units_invalid';
  end if;
  select * into v_job from public.inventory_label_print_jobs
    where organization_id=p_organization_id and id=p_print_job_id and location_id=p_location_id for update;
  if not found then raise exception using errcode='P0002',message='inventory_print_job_not_found'; end if;
  if v_job.status='printed' then raise exception using errcode='P0001',message='inventory_print_job_already_printed'; end if;
  if jsonb_array_length(p_units)<>v_job.label_count then
    raise exception using errcode='22023',message='inventory_print_job_count_mismatch';
  end if;
  if exists(
    select 1 from public.inventory_stock_units
    where organization_id=p_organization_id and print_job_id=p_print_job_id and status in('issued','waste')
  ) then raise exception using errcode='P0001',message='inventory_print_job_units_already_used'; end if;

  update public.inventory_stock_units set status='revoked',version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and print_job_id=p_print_job_id and status='available';
  select * into strict v_pack from public.inventory_pack_units
    where organization_id=p_organization_id and id=v_job.pack_unit_id and item_id=v_job.item_id and active=true;
  insert into public.inventory_stock_units(
    organization_id,location_id,item_id,pack_unit_id,receipt_id,print_job_id,token_hash,short_code,base_quantity
  )
    select p_organization_id,p_location_id,v_job.item_id,v_job.pack_unit_id,v_job.receipt_id,p_print_job_id,
      decode(u.token_hash,'hex'),upper(u.short_code),v_pack.base_quantity
    from jsonb_to_recordset(p_units) as u(token_hash text,short_code text)
    where u.token_hash~'^[0-9a-f]{64}$' and u.short_code~'^[A-Za-z0-9-]{6,20}$';
  get diagnostics v_count=row_count;
  if v_count<>v_job.label_count then raise exception using errcode='22023',message='inventory_qr_units_invalid'; end if;
  update public.inventory_label_print_jobs set status='prepared',generation=generation+1,
    prepared_at=clock_timestamp(),updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_print_job_id;
  return jsonb_build_object(
    'printJobId',p_print_job_id,'status','prepared','labelCount',v_job.label_count,
    'itemId',v_job.item_id,'generation',v_job.generation+1,'preparedBy',p_actor_id
  );
exception when unique_violation then
  raise exception using errcode='23505',message='inventory_qr_duplicate';
end $$;

create or replace function public.aora_inventory_confirm_print_job(
  p_organization_id uuid,p_location_id text,p_print_job_id uuid,p_actor_id text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_job public.inventory_label_print_jobs%rowtype;
  v_active_count integer;
begin
  select * into v_job from public.inventory_label_print_jobs
    where organization_id=p_organization_id and id=p_print_job_id and location_id=p_location_id for update;
  if not found then raise exception using errcode='P0002',message='inventory_print_job_not_found'; end if;
  if v_job.status='printed' then
    return jsonb_build_object('printJobId',p_print_job_id,'status','printed','idempotent',true);
  end if;
  if v_job.status<>'prepared' then
    raise exception using errcode='P0001',message='inventory_print_job_not_prepared';
  end if;
  select count(*) into v_active_count from public.inventory_stock_units
    where organization_id=p_organization_id and print_job_id=p_print_job_id and status in('available','issued','waste');
  if v_active_count<>v_job.label_count then
    raise exception using errcode='P0001',message='inventory_print_job_unit_invariant_failed';
  end if;
  update public.inventory_label_print_jobs set status='printed',printed_at=clock_timestamp(),printed_by=p_actor_id,updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_print_job_id;
  return jsonb_build_object('printJobId',p_print_job_id,'status','printed','labelCount',v_job.label_count,'idempotent',false);
end $$;

revoke all on function public.aora_inventory_receive_pending_labels(uuid,text,uuid,uuid,integer,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.aora_inventory_prepare_print_job(uuid,text,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_confirm_print_job(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_receive_pending_labels(uuid,text,uuid,uuid,integer,text,text,text,uuid) to service_role;
grant execute on function public.aora_inventory_prepare_print_job(uuid,text,uuid,jsonb,text) to service_role;
grant execute on function public.aora_inventory_confirm_print_job(uuid,text,uuid,text) to service_role;
commit;
