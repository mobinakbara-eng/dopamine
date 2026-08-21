create or replace function public.aora_inventory_apply_movement(
  p_organization_id uuid,
  p_location_id text,
  p_item_id uuid,
  p_kind text,
  p_quantity numeric,
  p_reason_code text,
  p_reference_type text,
  p_reference_id text,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_existing jsonb;
  v_balance public.inventory_balances%rowtype;
  v_delta numeric(20,6);
  v_new_on_hand numeric(20,6);
  v_movement_id uuid:=gen_random_uuid();
  v_result jsonb;
begin
  if p_organization_id is null or nullif(trim(p_location_id),'') is null or p_item_id is null then
    raise exception using errcode='22023',message='inventory_input_incomplete';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000 then
    raise exception using errcode='22023',message='inventory_quantity_invalid';
  end if;
  if nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 220 then
    raise exception using errcode='22023',message='inventory_idempotency_invalid';
  end if;
  if p_actor_role not in ('owner','manager','employee','system') then
    raise exception using errcode='22023',message='inventory_actor_invalid';
  end if;

  select result_snapshot into v_existing
  from public.inventory_movements
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return v_existing||jsonb_build_object('idempotent',true); end if;

  if p_kind in ('opening_balance','receipt','adjustment_in') then v_delta:=abs(p_quantity);
  elsif p_kind in ('consumption','waste','adjustment_out') then v_delta:=-abs(p_quantity);
  else raise exception using errcode='22023',message='inventory_movement_kind_invalid';
  end if;

  perform 1 from public.inventory_item_locations
  where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id and active=true;
  if not found then raise exception using errcode='P0002',message='inventory_item_location_not_found'; end if;

  insert into public.inventory_balances(organization_id,location_id,item_id)
  values(p_organization_id,p_location_id,p_item_id)
  on conflict do nothing;

  select * into strict v_balance
  from public.inventory_balances
  where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id
  for update;

  v_new_on_hand:=v_balance.on_hand+v_delta;
  if v_new_on_hand < 0 then
    raise exception using errcode='P0001',message='inventory_insufficient_stock';
  end if;

  v_result:=jsonb_build_object(
    'movementId',v_movement_id,'locationId',p_location_id,'itemId',p_item_id,
    'movementType',p_kind,'quantityDelta',v_delta,'onHand',v_new_on_hand,
    'version',v_balance.version+1,'idempotent',false
  );

  insert into public.inventory_movements(
    organization_id,id,location_id,item_id,movement_type,quantity_delta,reason_code,
    reference_type,reference_id,actor_id,actor_role,idempotency_key,result_snapshot
  ) values(
    p_organization_id,v_movement_id,p_location_id,p_item_id,p_kind,v_delta,
    nullif(left(trim(coalesce(p_reason_code,'')),120),''),
    nullif(left(trim(coalesce(p_reference_type,'')),80),''),
    nullif(left(trim(coalesce(p_reference_id,'')),160),''),
    p_actor_id,p_actor_role,p_idempotency_key,v_result
  );

  update public.inventory_balances
  set on_hand=v_new_on_hand,version=version+1,updated_at=clock_timestamp()
  where organization_id=p_organization_id and location_id=p_location_id and item_id=p_item_id;

  insert into public.inventory_outbox(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(p_organization_id,'inventory.changed','balance',p_location_id||':'||p_item_id::text,v_result);

  return v_result;
end $$;

create or replace function public.aora_inventory_create_item(
  p_organization_id uuid,p_location_id text,p_sku text,p_barcode text,p_name text,
  p_base_uom text,p_category text,p_reorder_point numeric,p_actor_id text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_id uuid:=gen_random_uuid();
begin
  if nullif(trim(p_sku),'') is null or nullif(trim(p_name),'') is null then
    raise exception using errcode='22023',message='inventory_item_input_invalid';
  end if;
  if p_base_uom not in ('piece','kg','g','l','ml','box','pack') then
    raise exception using errcode='22023',message='inventory_uom_invalid';
  end if;
  perform 1 from public.locations where organization_id=p_organization_id and id=p_location_id and active=true and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='inventory_location_not_found'; end if;
  insert into public.inventory_items(organization_id,id,sku,barcode,name,base_uom,category,created_by,updated_by)
  values(p_organization_id,v_id,upper(left(trim(p_sku),80)),nullif(left(trim(coalesce(p_barcode,'')),120),''),left(trim(p_name),160),p_base_uom,
    nullif(left(trim(coalesce(p_category,'')),100),''),p_actor_id,p_actor_id);
  insert into public.inventory_item_locations(organization_id,location_id,item_id,reorder_point)
  values(p_organization_id,p_location_id,v_id,greatest(coalesce(p_reorder_point,0),0));
  insert into public.inventory_balances(organization_id,location_id,item_id) values(p_organization_id,p_location_id,v_id);
  return jsonb_build_object('itemId',v_id,'locationId',p_location_id,'sku',upper(left(trim(p_sku),80)),'version',1);
exception when unique_violation then
  raise exception using errcode='23505',message='inventory_item_duplicate';
end $$;

create or replace function public.aora_inventory_create_transfer(
  p_organization_id uuid,
  p_source_location_id text,
  p_destination_location_id text,
  p_lines jsonb,
  p_note text,
  p_actor_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_id uuid:=gen_random_uuid();
  v_existing uuid;
  v_count integer;
begin
  if p_source_location_id=p_destination_location_id or nullif(p_source_location_id,'') is null or nullif(p_destination_location_id,'') is null then
    raise exception using errcode='22023',message='inventory_transfer_locations_invalid';
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then
    raise exception using errcode='22023',message='inventory_transfer_lines_invalid';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception using errcode='22023',message='inventory_idempotency_invalid'; end if;

  select id into v_existing from public.inventory_transfers
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('transferId',v_existing,'status','draft','idempotent',true); end if;

  perform 1 from public.locations where organization_id=p_organization_id and id=p_source_location_id and active=true and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='inventory_source_location_not_found'; end if;
  perform 1 from public.locations where organization_id=p_organization_id and id=p_destination_location_id and active=true and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='inventory_destination_location_not_found'; end if;

  insert into public.inventory_transfers(
    organization_id,id,source_location_id,destination_location_id,note,idempotency_key,created_by,updated_by
  ) values(
    p_organization_id,v_id,p_source_location_id,p_destination_location_id,
    nullif(left(trim(coalesce(p_note,'')),500),''),p_idempotency_key,p_actor_id,p_actor_id
  );

  insert into public.inventory_transfer_lines(organization_id,transfer_id,item_id,requested_quantity)
  select p_organization_id,v_id,line.item_id,sum(line.quantity)::numeric(20,6)
  from jsonb_to_recordset(p_lines) as line(item_id uuid,quantity numeric)
  where line.item_id is not null and line.quantity>0 and line.quantity<=1000000000
  group by line.item_id;
  get diagnostics v_count=row_count;
  if v_count=0 or v_count<>(select count(distinct (value->>'item_id')) from jsonb_array_elements(p_lines)) then
    raise exception using errcode='22023',message='inventory_transfer_lines_invalid';
  end if;

  if exists(
    select 1 from public.inventory_transfer_lines line
    where line.organization_id=p_organization_id and line.transfer_id=v_id
      and (not exists(select 1 from public.inventory_item_locations il where il.organization_id=p_organization_id and il.location_id=p_source_location_id and il.item_id=line.item_id and il.active=true)
        or not exists(select 1 from public.inventory_item_locations il where il.organization_id=p_organization_id and il.location_id=p_destination_location_id and il.item_id=line.item_id and il.active=true))
  ) then raise exception using errcode='P0002',message='inventory_item_location_not_found'; end if;

  insert into public.inventory_outbox(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(p_organization_id,'inventory.transfer.created','transfer',v_id::text,jsonb_build_object('transferId',v_id));
  return jsonb_build_object('transferId',v_id,'status','draft','version',1,'idempotent',false);
end $$;

create or replace function public.aora_inventory_dispatch_transfer(
  p_organization_id uuid,
  p_transfer_id uuid,
  p_expected_version integer,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
  v_line record;
  v_balance public.inventory_balances%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_result jsonb;
begin
  select * into v_transfer from public.inventory_transfers
  where organization_id=p_organization_id and id=p_transfer_id for update;
  if not found then raise exception using errcode='P0002',message='inventory_transfer_not_found'; end if;
  if v_transfer.status='dispatched' then return jsonb_build_object('transferId',p_transfer_id,'status','dispatched','version',v_transfer.version,'idempotent',true); end if;
  if v_transfer.status<>'draft' then raise exception using errcode='P0001',message='inventory_transfer_state_invalid'; end if;
  if v_transfer.version<>p_expected_version then raise exception using errcode='40001',message='inventory_version_conflict'; end if;

  for v_line in select * from public.inventory_transfer_lines
    where organization_id=p_organization_id and transfer_id=p_transfer_id order by item_id
  loop
    insert into public.inventory_balances(organization_id,location_id,item_id)
    values
      (p_organization_id,v_transfer.source_location_id,v_line.item_id),
      (p_organization_id,v_transfer.destination_location_id,v_line.item_id)
    on conflict do nothing;

    perform 1 from public.inventory_balances
    where organization_id=p_organization_id and item_id=v_line.item_id
      and location_id in (v_transfer.source_location_id,v_transfer.destination_location_id)
    order by location_id for update;

    select * into strict v_balance from public.inventory_balances
    where organization_id=p_organization_id and location_id=v_transfer.source_location_id and item_id=v_line.item_id;
    if v_balance.on_hand<v_line.requested_quantity then
      raise exception using errcode='P0001',message='inventory_insufficient_stock';
    end if;

    update public.inventory_balances set on_hand=on_hand-v_line.requested_quantity,version=version+1,updated_at=v_now
    where organization_id=p_organization_id and location_id=v_transfer.source_location_id and item_id=v_line.item_id;
    update public.inventory_balances set in_transit_in=in_transit_in+v_line.requested_quantity,version=version+1,updated_at=v_now
    where organization_id=p_organization_id and location_id=v_transfer.destination_location_id and item_id=v_line.item_id;

    insert into public.inventory_movements(
      organization_id,location_id,item_id,movement_type,quantity_delta,reference_type,reference_id,
      actor_id,actor_role,idempotency_key,result_snapshot
    ) values(
      p_organization_id,v_transfer.source_location_id,v_line.item_id,'transfer_out',-v_line.requested_quantity,
      'transfer',p_transfer_id::text,p_actor_id,p_actor_role,p_idempotency_key||':dispatch:'||v_line.item_id::text,
      jsonb_build_object('transferId',p_transfer_id,'locationId',v_transfer.source_location_id,'itemId',v_line.item_id,'quantityDelta',-v_line.requested_quantity)
    );
    update public.inventory_transfer_lines set dispatched_quantity=requested_quantity
    where organization_id=p_organization_id and transfer_id=p_transfer_id and item_id=v_line.item_id;
  end loop;

  update public.inventory_transfers set status='dispatched',version=version+1,dispatched_at=v_now,updated_at=v_now,updated_by=p_actor_id
  where organization_id=p_organization_id and id=p_transfer_id;
  v_result:=jsonb_build_object('transferId',p_transfer_id,'status','dispatched','version',v_transfer.version+1,'idempotent',false);
  insert into public.inventory_outbox(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(p_organization_id,'inventory.transfer.dispatched','transfer',p_transfer_id::text,v_result);
  return v_result;
end $$;

create or replace function public.aora_inventory_receive_transfer(
  p_organization_id uuid,
  p_transfer_id uuid,
  p_expected_version integer,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
  v_line record;
  v_now timestamptz:=clock_timestamp();
  v_result jsonb;
begin
  select * into v_transfer from public.inventory_transfers
  where organization_id=p_organization_id and id=p_transfer_id for update;
  if not found then raise exception using errcode='P0002',message='inventory_transfer_not_found'; end if;
  if v_transfer.status='received' then return jsonb_build_object('transferId',p_transfer_id,'status','received','version',v_transfer.version,'idempotent',true); end if;
  if v_transfer.status<>'dispatched' then raise exception using errcode='P0001',message='inventory_transfer_state_invalid'; end if;
  if v_transfer.version<>p_expected_version then raise exception using errcode='40001',message='inventory_version_conflict'; end if;

  for v_line in select * from public.inventory_transfer_lines
    where organization_id=p_organization_id and transfer_id=p_transfer_id order by item_id
  loop
    perform 1 from public.inventory_balances
    where organization_id=p_organization_id and location_id=v_transfer.destination_location_id and item_id=v_line.item_id
    for update;
    if not found then raise exception using errcode='P0002',message='inventory_balance_not_found'; end if;
    update public.inventory_balances
    set in_transit_in=in_transit_in-v_line.dispatched_quantity,on_hand=on_hand+v_line.dispatched_quantity,
        version=version+1,updated_at=v_now
    where organization_id=p_organization_id and location_id=v_transfer.destination_location_id and item_id=v_line.item_id
      and in_transit_in>=v_line.dispatched_quantity;
    if not found then raise exception using errcode='P0001',message='inventory_transit_invariant_failed'; end if;

    insert into public.inventory_movements(
      organization_id,location_id,item_id,movement_type,quantity_delta,reference_type,reference_id,
      actor_id,actor_role,idempotency_key,result_snapshot
    ) values(
      p_organization_id,v_transfer.destination_location_id,v_line.item_id,'transfer_in',v_line.dispatched_quantity,
      'transfer',p_transfer_id::text,p_actor_id,p_actor_role,p_idempotency_key||':receive:'||v_line.item_id::text,
      jsonb_build_object('transferId',p_transfer_id,'locationId',v_transfer.destination_location_id,'itemId',v_line.item_id,'quantityDelta',v_line.dispatched_quantity)
    );
    update public.inventory_transfer_lines set received_quantity=dispatched_quantity
    where organization_id=p_organization_id and transfer_id=p_transfer_id and item_id=v_line.item_id;
  end loop;

  update public.inventory_transfers set status='received',version=version+1,received_at=v_now,updated_at=v_now,updated_by=p_actor_id
  where organization_id=p_organization_id and id=p_transfer_id;
  v_result:=jsonb_build_object('transferId',p_transfer_id,'status','received','version',v_transfer.version+1,'idempotent',false);
  insert into public.inventory_outbox(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(p_organization_id,'inventory.transfer.received','transfer',p_transfer_id::text,v_result);
  return v_result;
end $$;

create or replace function public.aora_inventory_cancel_transfer(
  p_organization_id uuid,p_transfer_id uuid,p_expected_version integer,p_actor_id text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_transfer public.inventory_transfers%rowtype;
begin
  select * into v_transfer from public.inventory_transfers where organization_id=p_organization_id and id=p_transfer_id for update;
  if not found then raise exception using errcode='P0002',message='inventory_transfer_not_found'; end if;
  if v_transfer.status='cancelled' then return jsonb_build_object('transferId',p_transfer_id,'status','cancelled','version',v_transfer.version,'idempotent',true); end if;
  if v_transfer.status<>'draft' then raise exception using errcode='P0001',message='inventory_transfer_state_invalid'; end if;
  if v_transfer.version<>p_expected_version then raise exception using errcode='40001',message='inventory_version_conflict'; end if;
  update public.inventory_transfers set status='cancelled',version=version+1,updated_by=p_actor_id,updated_at=clock_timestamp()
  where organization_id=p_organization_id and id=p_transfer_id;
  insert into public.inventory_outbox(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(p_organization_id,'inventory.transfer.cancelled','transfer',p_transfer_id::text,jsonb_build_object('transferId',p_transfer_id));
  return jsonb_build_object('transferId',p_transfer_id,'status','cancelled','version',v_transfer.version+1,'idempotent',false);
end $$;

revoke all on function public.aora_inventory_apply_movement(uuid,text,uuid,text,numeric,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_create_item(uuid,text,text,text,text,text,text,numeric,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_create_transfer(uuid,text,text,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_dispatch_transfer(uuid,uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_receive_transfer(uuid,uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_cancel_transfer(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_apply_movement(uuid,text,uuid,text,numeric,text,text,text,text,text,text) to service_role;
grant execute on function public.aora_inventory_create_item(uuid,text,text,text,text,text,text,numeric,text) to service_role;
grant execute on function public.aora_inventory_create_transfer(uuid,text,text,jsonb,text,text,text) to service_role;
grant execute on function public.aora_inventory_dispatch_transfer(uuid,uuid,integer,text,text,text) to service_role;
grant execute on function public.aora_inventory_receive_transfer(uuid,uuid,integer,text,text,text) to service_role;
grant execute on function public.aora_inventory_cancel_transfer(uuid,uuid,integer,text) to service_role;
