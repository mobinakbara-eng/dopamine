begin;

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
  if p_actor_role not in('owner','manager') then
    raise exception using errcode='42501',message='inventory_receipt_actor_forbidden';
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then
    raise exception using errcode='22023',message='inventory_receipt_lines_invalid';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then
    raise exception using errcode='22023',message='inventory_idempotency_invalid';
  end if;

  select * into v_existing
    from public.inventory_goods_receipts
   where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    select coalesce(jsonb_agg(id order by created_at),'[]'::jsonb)
      into v_print_jobs
      from public.inventory_label_print_jobs
     where organization_id=p_organization_id and receipt_id=v_existing.id;
    return jsonb_build_object(
      'receiptId',v_existing.id,'status',v_existing.status,
      'printJobIds',v_print_jobs,'idempotent',true
    );
  end if;

  select * into v_order
    from public.inventory_purchase_orders
   where organization_id=p_organization_id
     and id=p_purchase_order_id
     and location_id=p_location_id
     and status in('submitted','placed','delivered','partially_received')
   for update;
  if not found then
    raise exception using errcode='P0001',message='inventory_purchase_order_not_receivable';
  end if;

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
    if coalesce(v_input.good_pack_count,0)<0
       or coalesce(v_input.damaged_pack_count,0)<0
       or coalesce(v_input.missing_pack_count,0)<0
       or coalesce(v_input.good_pack_count,0)>10000
       or coalesce(v_input.damaged_pack_count,0)>10000
       or coalesce(v_input.missing_pack_count,0)>10000 then
      raise exception using errcode='22023',message='inventory_receipt_quantity_invalid';
    end if;
    if coalesce(v_input.good_pack_count,0)+coalesce(v_input.damaged_pack_count,0)+coalesce(v_input.missing_pack_count,0)<=0 then
      raise exception using errcode='22023',message='inventory_receipt_quantity_invalid';
    end if;

    select * into v_line
      from public.inventory_purchase_order_lines
     where organization_id=p_organization_id
       and purchase_order_id=p_purchase_order_id
       and item_id=v_input.item_id
     for update;
    if not found then raise exception using errcode='P0002',message='inventory_purchase_order_line_not_found'; end if;

    select * into v_pack
      from public.inventory_pack_units
     where organization_id=p_organization_id
       and id=v_input.pack_unit_id
       and item_id=v_input.item_id
       and active=true;
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
        p_organization_id,v_receipt_id,v_line_no,v_input.item_id,v_input.pack_unit_id,
        v_input.good_pack_count,v_good
      );

      update public.inventory_purchase_order_lines
         set received_quantity=received_quantity+v_good
       where organization_id=p_organization_id
         and purchase_order_id=p_purchase_order_id
         and item_id=v_input.item_id;

      v_move:=public.aora_inventory_apply_movement(
        p_organization_id,p_location_id,v_input.item_id,'receipt',v_good,
        'goods_receipt','goods_receipt',v_receipt_id::text,
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
        'damaged',v_input.damaged_pack_count,v_damaged,
        nullif(left(trim(coalesce(v_input.note,'')),500),''),p_actor_id
      );
    end if;

    if v_missing>0 then
      v_exception_count:=v_exception_count+1;
      insert into public.inventory_receipt_exceptions(
        organization_id,receipt_id,purchase_order_id,location_id,item_id,pack_unit_id,
        exception_type,pack_count,base_quantity,note,created_by
      ) values(
        p_organization_id,v_receipt_id,p_purchase_order_id,p_location_id,v_input.item_id,v_input.pack_unit_id,
        'missing',v_input.missing_pack_count,v_missing,
        nullif(left(trim(coalesce(v_input.note,'')),500),''),p_actor_id
      );
    end if;
  end loop;

  if v_good_line_count=0 and v_exception_count=0 then
    raise exception using errcode='22023',message='inventory_receipt_lines_invalid';
  end if;

  if exists(
    select 1 from public.inventory_purchase_order_lines
     where organization_id=p_organization_id
       and purchase_order_id=p_purchase_order_id
       and received_quantity<ordered_quantity
  ) then
    v_status:='partially_received';
  else
    v_status:='received';
  end if;

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

revoke all on function public.aora_inventory_receive_purchase_order_delivery(uuid,text,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_receive_purchase_order_delivery(uuid,text,uuid,jsonb,text,text,text) to service_role;

commit;
