begin;

alter table public.inventory_transfers
  add column if not exists enforce_source_floor boolean not null default false,
  add column if not exists replenishment_episode_id uuid;

create or replace function public.aora_inventory_create_autopilot_transfer(
  p_organization_id uuid,
  p_source_location_id text,
  p_destination_location_id text,
  p_lines jsonb,
  p_note text,
  p_actor_id text,
  p_idempotency_key text,
  p_replenishment_episode_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_result jsonb;
  v_transfer_id uuid;
  v_line record;
  v_balance public.inventory_balances%rowtype;
  v_policy public.inventory_item_locations%rowtype;
  v_floor numeric(20,6);
begin
  v_result:=public.aora_inventory_create_transfer(
    p_organization_id,
    p_source_location_id,
    p_destination_location_id,
    p_lines,
    p_note,
    p_actor_id,
    p_idempotency_key
  );
  v_transfer_id:=(v_result->>'transferId')::uuid;

  -- A retry of an already-created Autopilot transfer keeps the same identity.
  -- Dispatch performs the authoritative floor re-check immediately before stock
  -- is moved, so an idempotent creation retry does not need to fail merely because
  -- the source changed after the draft was created.
  if coalesce((v_result->>'idempotent')::boolean,false) then
    update public.inventory_transfers
       set enforce_source_floor=true,
           replenishment_episode_id=coalesce(replenishment_episode_id,p_replenishment_episode_id)
     where organization_id=p_organization_id
       and id=v_transfer_id;
    return v_result || jsonb_build_object('sourceFloorEnforced',true);
  end if;

  for v_line in
    select *
      from public.inventory_transfer_lines
     where organization_id=p_organization_id
       and transfer_id=v_transfer_id
     order by item_id
  loop
    select * into v_balance
      from public.inventory_balances
     where organization_id=p_organization_id
       and location_id=p_source_location_id
       and item_id=v_line.item_id
     for update;
    if not found then
      raise exception using errcode='P0002',message='inventory_balance_not_found';
    end if;

    select * into v_policy
      from public.inventory_item_locations
     where organization_id=p_organization_id
       and location_id=p_source_location_id
       and item_id=v_line.item_id
       and active=true
     for share;
    if not found then
      raise exception using errcode='P0002',message='inventory_item_location_not_found';
    end if;

    v_floor:=greatest(coalesce(v_policy.reorder_point,0),coalesce(v_policy.par_level,0));
    if v_balance.on_hand-v_balance.reserved-v_line.requested_quantity < v_floor then
      raise exception using errcode='P0001',message='inventory_transfer_source_floor_changed';
    end if;
  end loop;

  update public.inventory_transfers
     set enforce_source_floor=true,
         replenishment_episode_id=p_replenishment_episode_id,
         updated_at=clock_timestamp(),
         updated_by=p_actor_id
   where organization_id=p_organization_id
     and id=v_transfer_id;

  return v_result || jsonb_build_object('sourceFloorEnforced',true);
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
  v_policy public.inventory_item_locations%rowtype;
  v_floor numeric(20,6);
  v_now timestamptz:=clock_timestamp();
  v_result jsonb;
begin
  select * into v_transfer
    from public.inventory_transfers
   where organization_id=p_organization_id
     and id=p_transfer_id
   for update;
  if not found then
    raise exception using errcode='P0002',message='inventory_transfer_not_found';
  end if;
  if v_transfer.status='dispatched' then
    return jsonb_build_object('transferId',p_transfer_id,'status','dispatched','version',v_transfer.version,'idempotent',true);
  end if;
  if v_transfer.status<>'draft' then
    raise exception using errcode='P0001',message='inventory_transfer_state_invalid';
  end if;
  if v_transfer.version<>p_expected_version then
    raise exception using errcode='40001',message='inventory_version_conflict';
  end if;

  for v_line in
    select *
      from public.inventory_transfer_lines
     where organization_id=p_organization_id
       and transfer_id=p_transfer_id
     order by item_id
  loop
    insert into public.inventory_balances(organization_id,location_id,item_id)
    values
      (p_organization_id,v_transfer.source_location_id,v_line.item_id),
      (p_organization_id,v_transfer.destination_location_id,v_line.item_id)
    on conflict do nothing;

    perform 1
      from public.inventory_balances
     where organization_id=p_organization_id
       and item_id=v_line.item_id
       and location_id in(v_transfer.source_location_id,v_transfer.destination_location_id)
     order by location_id
     for update;

    select * into strict v_balance
      from public.inventory_balances
     where organization_id=p_organization_id
       and location_id=v_transfer.source_location_id
       and item_id=v_line.item_id;
    if v_balance.on_hand<v_line.requested_quantity then
      raise exception using errcode='P0001',message='inventory_insufficient_stock';
    end if;

    if v_transfer.enforce_source_floor then
      select * into v_policy
        from public.inventory_item_locations
       where organization_id=p_organization_id
         and location_id=v_transfer.source_location_id
         and item_id=v_line.item_id
         and active=true
       for share;
      if not found then
        raise exception using errcode='P0002',message='inventory_item_location_not_found';
      end if;
      v_floor:=greatest(coalesce(v_policy.reorder_point,0),coalesce(v_policy.par_level,0));
      if v_balance.on_hand-v_balance.reserved-v_line.requested_quantity < v_floor then
        raise exception using errcode='P0001',message='inventory_transfer_source_floor_changed';
      end if;
    end if;

    update public.inventory_balances
       set on_hand=on_hand-v_line.requested_quantity,
           version=version+1,
           updated_at=v_now
     where organization_id=p_organization_id
       and location_id=v_transfer.source_location_id
       and item_id=v_line.item_id;
    update public.inventory_balances
       set in_transit_in=in_transit_in+v_line.requested_quantity,
           version=version+1,
           updated_at=v_now
     where organization_id=p_organization_id
       and location_id=v_transfer.destination_location_id
       and item_id=v_line.item_id;

    insert into public.inventory_movements(
      organization_id,location_id,item_id,movement_type,quantity_delta,reference_type,reference_id,
      actor_id,actor_role,idempotency_key,result_snapshot
    ) values(
      p_organization_id,v_transfer.source_location_id,v_line.item_id,'transfer_out',-v_line.requested_quantity,
      'transfer',p_transfer_id::text,p_actor_id,p_actor_role,p_idempotency_key||':dispatch:'||v_line.item_id::text,
      jsonb_build_object('transferId',p_transfer_id,'locationId',v_transfer.source_location_id,'itemId',v_line.item_id,'quantityDelta',-v_line.requested_quantity)
    );
    update public.inventory_transfer_lines
       set dispatched_quantity=requested_quantity
     where organization_id=p_organization_id
       and transfer_id=p_transfer_id
       and item_id=v_line.item_id;
  end loop;

  update public.inventory_transfers
     set status='dispatched',
         version=version+1,
         dispatched_at=v_now,
         updated_at=v_now,
         updated_by=p_actor_id
   where organization_id=p_organization_id
     and id=p_transfer_id;
  v_result:=jsonb_build_object('transferId',p_transfer_id,'status','dispatched','version',v_transfer.version+1,'idempotent',false);
  insert into public.inventory_outbox(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(p_organization_id,'inventory.transfer.dispatched','transfer',p_transfer_id::text,v_result);
  return v_result;
end $$;

revoke all on function public.aora_inventory_create_autopilot_transfer(uuid,text,text,jsonb,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.aora_inventory_create_autopilot_transfer(uuid,text,text,jsonb,text,text,text,uuid) to service_role;
revoke all on function public.aora_inventory_dispatch_transfer(uuid,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_dispatch_transfer(uuid,uuid,integer,text,text,text) to service_role;

commit;
