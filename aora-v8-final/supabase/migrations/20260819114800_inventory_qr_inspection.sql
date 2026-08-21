begin;

create or replace function public.aora_inventory_inspect_qr_unit(
  p_organization_id uuid,
  p_location_id text,
  p_token_hash_hex text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
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
    'stockUnitId',v_unit.id,
    'itemId',v_unit.item_id,
    'packUnitId',v_unit.pack_unit_id,
    'baseQuantity',v_unit.base_quantity,
    'remainingQuantity',v_unit.remaining_quantity,
    'consumptionMode',v_mode,
    'defaultConsumeQuantity',v_default
  );
end $$;

create or replace function public.aora_inventory_inspect_qr_short_code(
  p_organization_id uuid,
  p_location_id text,
  p_short_code text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
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
    'stockUnitId',v_unit.id,
    'itemId',v_unit.item_id,
    'packUnitId',v_unit.pack_unit_id,
    'baseQuantity',v_unit.base_quantity,
    'remainingQuantity',v_unit.remaining_quantity,
    'consumptionMode',v_mode,
    'defaultConsumeQuantity',v_default
  );
end $$;

revoke all on function public.aora_inventory_inspect_qr_unit(uuid,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_inspect_qr_short_code(uuid,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_inspect_qr_unit(uuid,text,text) to service_role;
grant execute on function public.aora_inventory_inspect_qr_short_code(uuid,text,text) to service_role;

commit;
