begin;

alter table public.inventory_items
  add column if not exists expiry_tracking boolean not null default false,
  add column if not exists default_shelf_life_days integer,
  add column if not exists expiry_alert_days integer not null default 3;

alter table public.inventory_items
  drop constraint if exists inventory_items_default_shelf_life_days_check,
  add constraint inventory_items_default_shelf_life_days_check check (default_shelf_life_days is null or default_shelf_life_days between 1 and 3650),
  drop constraint if exists inventory_items_expiry_alert_days_check,
  add constraint inventory_items_expiry_alert_days_check check (expiry_alert_days between 0 and 3650);

alter table public.inventory_goods_receipt_lines
  add column if not exists lot_code text,
  add column if not exists expires_on date;

alter table public.inventory_label_print_jobs
  add column if not exists lot_code text,
  add column if not exists expires_on date;

alter table public.inventory_stock_units
  add column if not exists lot_code text,
  add column if not exists expires_on date;

create index if not exists inventory_stock_units_expiry_idx
  on public.inventory_stock_units(organization_id,location_id,expires_on,item_id)
  where status='available' and expires_on is not null;

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
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_receipt_id uuid:=gen_random_uuid();
  v_existing public.inventory_goods_receipts%rowtype;
  v_input record;
  v_line public.inventory_purchase_order_lines%rowtype;
  v_pack public.inventory_pack_units%rowtype;
  v_item public.inventory_items%rowtype;
  v_open numeric(20,6);
  v_good numeric(20,6);
  v_damaged numeric(20,6);
  v_missing numeric(20,6);
  v_observed numeric(20,6);
  v_expires_on date;
  v_lot_code text;
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
      note text,
      lot_code text,
      expires_on date
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

    select * into v_item
      from public.inventory_items
     where organization_id=p_organization_id and id=v_input.item_id and active=true;
    if not found then raise exception using errcode='P0002',message='inventory_item_not_found'; end if;

    v_open:=greatest(v_line.ordered_quantity-v_line.received_quantity,0);
    v_good:=coalesce(v_input.good_pack_count,0)*v_pack.base_quantity;
    v_damaged:=coalesce(v_input.damaged_pack_count,0)*v_pack.base_quantity;
    v_missing:=coalesce(v_input.missing_pack_count,0)*v_pack.base_quantity;
    v_observed:=v_good+v_damaged+v_missing;
    if v_observed>v_open+0.000001 then
      raise exception using errcode='22023',message='inventory_purchase_order_quantity_exceeded';
    end if;

    v_expires_on:=v_input.expires_on;
    v_lot_code:=nullif(left(trim(coalesce(v_input.lot_code,'')),80),'');
    if v_good>0 and v_item.expiry_tracking and v_expires_on is null and v_item.default_shelf_life_days is not null then
      v_expires_on:=current_date+v_item.default_shelf_life_days;
    end if;
    if v_good>0 and v_item.expiry_tracking and v_expires_on is null then
      raise exception using errcode='22023',message='inventory_expiry_required';
    end if;
    if v_expires_on is not null and v_expires_on<current_date then
      raise exception using errcode='22023',message='inventory_expiry_in_past';
    end if;

    if v_good>0 then
      v_line_no:=v_line_no+1;
      v_good_line_count:=v_good_line_count+1;
      insert into public.inventory_goods_receipt_lines(
        organization_id,receipt_id,line_no,item_id,pack_unit_id,pack_count,base_quantity,lot_code,expires_on
      ) values(
        p_organization_id,v_receipt_id,v_line_no,v_input.item_id,v_input.pack_unit_id,
        v_input.good_pack_count,v_good,v_lot_code,v_expires_on
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
          organization_id,id,location_id,receipt_id,purchase_order_id,item_id,pack_unit_id,label_count,created_by,lot_code,expires_on
        ) values(
          p_organization_id,v_print_job_id,p_location_id,v_receipt_id,p_purchase_order_id,
          v_input.item_id,v_input.pack_unit_id,v_input.good_pack_count,p_actor_id,v_lot_code,v_expires_on
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
end
$function$;

create or replace function public.aora_inventory_prepare_print_job(
  p_organization_id uuid,
  p_location_id text,
  p_print_job_id uuid,
  p_units jsonb,
  p_actor_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
as $function$
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
    organization_id,location_id,item_id,pack_unit_id,receipt_id,print_job_id,token_hash,short_code,base_quantity,lot_code,expires_on
  )
    select p_organization_id,p_location_id,v_job.item_id,v_job.pack_unit_id,v_job.receipt_id,p_print_job_id,
      decode(u.token_hash,'hex'),upper(u.short_code),v_pack.base_quantity,v_job.lot_code,v_job.expires_on
    from jsonb_to_recordset(p_units) as u(token_hash text,short_code text)
    where u.token_hash~'^[0-9a-f]{64}$' and u.short_code~'^[A-Za-z0-9-]{6,20}$';
  get diagnostics v_count=row_count;
  if v_count<>v_job.label_count then raise exception using errcode='22023',message='inventory_qr_units_invalid'; end if;
  update public.inventory_label_print_jobs set status='prepared',generation=generation+1,
    prepared_at=clock_timestamp(),updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_print_job_id;
  return jsonb_build_object(
    'printJobId',p_print_job_id,'status','prepared','labelCount',v_job.label_count,
    'itemId',v_job.item_id,'generation',v_job.generation+1,'preparedBy',p_actor_id,
    'lotCode',v_job.lot_code,'expiresOn',v_job.expires_on
  );
exception when unique_violation then
  raise exception using errcode='23505',message='inventory_qr_duplicate';
end
$function$;

create or replace function public.aora_inventory_inspect_qr_unit(
  p_organization_id uuid,
  p_location_id text,
  p_token_hash_hex text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_unit public.inventory_stock_units%rowtype;
  v_mode text;
  v_default numeric(20,6);
begin
  select * into v_unit
    from public.inventory_stock_units
   where organization_id=p_organization_id
     and location_id=p_location_id
     and token_hash=decode(p_token_hash_hex,'hex');
  if not found then raise exception using errcode='P0002',message='inventory_qr_not_found'; end if;
  if v_unit.status<>'available' or v_unit.remaining_quantity<=0 then
    raise exception using errcode='P0001',message='inventory_qr_already_used_or_wrong_location';
  end if;
  select consumption_mode,default_consume_quantity into v_mode,v_default
    from public.inventory_items
   where organization_id=p_organization_id and id=v_unit.item_id;
  return jsonb_build_object(
    'stockUnitId',v_unit.id,'itemId',v_unit.item_id,'packUnitId',v_unit.pack_unit_id,
    'baseQuantity',v_unit.base_quantity,'remainingQuantity',v_unit.remaining_quantity,
    'consumptionMode',v_mode,'defaultConsumeQuantity',v_default,
    'shortCode',v_unit.short_code,'lotCode',v_unit.lot_code,'expiresOn',v_unit.expires_on
  );
end
$function$;

create or replace function public.aora_inventory_inspect_qr_short_code(
  p_organization_id uuid,
  p_location_id text,
  p_short_code text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_unit public.inventory_stock_units%rowtype;
  v_mode text;
  v_default numeric(20,6);
begin
  select * into v_unit
    from public.inventory_stock_units
   where organization_id=p_organization_id
     and location_id=p_location_id
     and upper(short_code)=upper(trim(p_short_code));
  if not found then raise exception using errcode='P0002',message='inventory_qr_not_found'; end if;
  if v_unit.status<>'available' or v_unit.remaining_quantity<=0 then
    raise exception using errcode='P0001',message='inventory_qr_already_used_or_wrong_location';
  end if;
  select consumption_mode,default_consume_quantity into v_mode,v_default
    from public.inventory_items
   where organization_id=p_organization_id and id=v_unit.item_id;
  return jsonb_build_object(
    'stockUnitId',v_unit.id,'itemId',v_unit.item_id,'packUnitId',v_unit.pack_unit_id,
    'baseQuantity',v_unit.base_quantity,'remainingQuantity',v_unit.remaining_quantity,
    'consumptionMode',v_mode,'defaultConsumeQuantity',v_default,
    'shortCode',v_unit.short_code,'lotCode',v_unit.lot_code,'expiresOn',v_unit.expires_on
  );
end
$function$;

revoke all on function public.aora_inventory_receive_purchase_order_delivery(uuid,text,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_receive_purchase_order_delivery(uuid,text,uuid,jsonb,text,text,text) to service_role;
revoke all on function public.aora_inventory_prepare_print_job(uuid,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_prepare_print_job(uuid,text,uuid,jsonb,text) to service_role;
revoke all on function public.aora_inventory_inspect_qr_unit(uuid,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_inspect_qr_unit(uuid,text,text) to service_role;
revoke all on function public.aora_inventory_inspect_qr_short_code(uuid,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_inspect_qr_short_code(uuid,text,text) to service_role;

commit;
