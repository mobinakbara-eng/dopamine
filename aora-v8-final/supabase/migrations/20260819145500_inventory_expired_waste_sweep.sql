begin;

create or replace function public.aora_inventory_waste_expired_stock_unit(
  p_organization_id uuid,
  p_location_id text,
  p_stock_unit_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_existing jsonb;
  v_unit public.inventory_stock_units%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_qty numeric(20,6);
  v_movement_id uuid:=gen_random_uuid();
  v_result jsonb;
begin
  if nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 220 then
    raise exception using errcode='22023',message='inventory_idempotency_invalid';
  end if;
  if p_actor_role not in('owner','manager') then
    raise exception using errcode='42501',message='inventory_expiry_waste_actor_forbidden';
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
  if v_unit.location_id<>p_location_id then
    raise exception using errcode='42501',message='inventory_qr_wrong_location';
  end if;
  if v_unit.status<>'available' or v_unit.remaining_quantity<=0 then
    raise exception using errcode='P0001',message='inventory_qr_already_used';
  end if;
  if v_unit.expires_on is null then
    raise exception using errcode='22023',message='inventory_expiry_missing';
  end if;
  if v_unit.expires_on>=current_date then
    raise exception using errcode='22023',message='inventory_not_expired';
  end if;

  select * into v_balance
    from public.inventory_balances
   where organization_id=p_organization_id and location_id=p_location_id and item_id=v_unit.item_id
   for update;
  if not found then raise exception using errcode='P0002',message='inventory_balance_not_found'; end if;

  v_qty:=v_unit.remaining_quantity;
  if v_balance.on_hand<v_qty then
    raise exception using errcode='P0001',message='inventory_balance_invariant_failed';
  end if;

  v_result:=jsonb_build_object(
    'movementId',v_movement_id,
    'stockUnitId',v_unit.id,
    'itemId',v_unit.item_id,
    'packUnitId',v_unit.pack_unit_id,
    'wastedQuantity',v_qty,
    'quantityDelta',-v_qty,
    'remainingQuantity',0,
    'onHand',v_balance.on_hand-v_qty,
    'shortCode',v_unit.short_code,
    'lotCode',v_unit.lot_code,
    'expiresOn',v_unit.expires_on,
    'reasonCode','expired',
    'idempotent',false
  );

  update public.inventory_stock_units
     set remaining_quantity=0,
         status='waste',
         last_consumed_at=clock_timestamp(),
         version=version+1,
         updated_at=clock_timestamp()
   where organization_id=p_organization_id and id=v_unit.id;

  insert into public.inventory_movements(
    organization_id,id,location_id,item_id,stock_unit_id,movement_type,quantity_delta,
    reason_code,reference_type,reference_id,actor_id,actor_role,idempotency_key,result_snapshot
  ) values(
    p_organization_id,v_movement_id,p_location_id,v_unit.item_id,v_unit.id,'waste',-v_qty,
    'expired','expiry_sweep',v_unit.id::text,p_actor_id,p_actor_role,p_idempotency_key,v_result
  );

  update public.inventory_balances
     set on_hand=on_hand-v_qty,version=version+1,updated_at=clock_timestamp()
   where organization_id=p_organization_id and location_id=p_location_id and item_id=v_unit.item_id;

  perform public.aora_inventory_evaluate_replenishment(p_organization_id,p_location_id,v_unit.item_id);

  insert into public.inventory_outbox(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(p_organization_id,'inventory.stock.expired_waste','stock_unit',v_unit.id::text,v_result);

  return v_result;
end
$function$;

revoke all on function public.aora_inventory_waste_expired_stock_unit(uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_waste_expired_stock_unit(uuid,text,uuid,text,text,text) to service_role;

commit;
