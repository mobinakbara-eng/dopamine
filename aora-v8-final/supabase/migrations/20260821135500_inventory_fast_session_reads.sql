create or replace function public.aora_inventory_authorize_fast_read(
  p_token text,
  p_location_id text,
  p_permission text default 'view'
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_ctx jsonb;
  v_role text;
  v_location_ok boolean:=false;
  v_permission_ok boolean:=false;
  v_feature_ok boolean:=false;
begin
  v_ctx:=public.aora_inventory_resolve_session(p_token);
  if coalesce(v_ctx->>'status','')<>'ok' then return v_ctx; end if;

  v_role:=coalesce(v_ctx->>'accessRole','');
  if v_role='employee' then
    return jsonb_build_object('status','employee_action_forbidden');
  end if;

  select exists(
    select 1 from jsonb_array_elements_text(coalesce(v_ctx->'locationIds','[]'::jsonb)) x(value)
    where x.value=p_location_id
  ) into v_location_ok;
  if not v_location_ok then return jsonb_build_object('status','location_forbidden'); end if;

  v_permission_ok:=v_role='owner' or exists(
    select 1
    from jsonb_array_elements(coalesce(v_ctx->'permissions','[]'::jsonb)) p(value)
    where p.value->>'locationId'=p_location_id
      and p.value->>'permission'=p_permission
  );
  if not v_permission_ok then return jsonb_build_object('status','inventory_permission_forbidden'); end if;

  select coalesce(
    (
      select (f.value->>'enabled')::boolean
      from jsonb_array_elements(coalesce(v_ctx->'features','[]'::jsonb)) f(value)
      where f.value->>'key'='inventory_v1'
        and f.value->>'locationId'=p_location_id
      limit 1
    ),
    (
      select (f.value->>'enabled')::boolean
      from jsonb_array_elements(coalesce(v_ctx->'features','[]'::jsonb)) f(value)
      where f.value->>'key'='inventory_v1'
        and (f.value->>'locationId') is null
      limit 1
    ),
    false
  ) into v_feature_ok;
  if not v_feature_ok then return jsonb_build_object('status','feature_disabled'); end if;

  return v_ctx;
end;
$$;

create or replace function public.aora_inventory_session_overview(
  p_token text,
  p_location_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_ctx jsonb;
  v_org uuid;
  v_data jsonb;
begin
  v_ctx:=public.aora_inventory_authorize_fast_read(p_token,p_location_id,'view');
  if coalesce(v_ctx->>'status','')<>'ok' then return v_ctx; end if;
  v_org:=(v_ctx->>'organizationId')::uuid;
  v_data:=public.aora_inventory_read_overview(v_org,p_location_id);
  return jsonb_build_object('status','ok','data',v_data);
end;
$$;

create or replace function public.aora_inventory_session_stock(
  p_token text,
  p_location_id text,
  p_search text default '',
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_ctx jsonb;
  v_org uuid;
  v_limit integer:=least(500,greatest(1,coalesce(p_limit,500)));
  v_search text:=lower(trim(coalesce(p_search,'')));
  v_items jsonb;
begin
  v_ctx:=public.aora_inventory_authorize_fast_read(p_token,p_location_id,'view');
  if coalesce(v_ctx->>'status','')<>'ok' then return v_ctx; end if;
  v_org:=(v_ctx->>'organizationId')::uuid;

  select coalesce(jsonb_agg(row_data order by updated_at desc),'[]'::jsonb)
  into v_items
  from (
    select
      b.updated_at,
      jsonb_build_object(
        'id',i.id,
        'sku',i.sku,
        'barcode',i.barcode,
        'name',i.name,
        'base_uom',i.base_uom,
        'category',i.category,
        'active',i.active,
        'version',i.version,
        'consumption_mode',i.consumption_mode,
        'default_consume_quantity',i.default_consume_quantity,
        'expiry_tracking',i.expiry_tracking,
        'default_shelf_life_days',i.default_shelf_life_days,
        'expiry_alert_days',i.expiry_alert_days,
        'itemId',b.item_id,
        'onHand',b.on_hand,
        'reserved',b.reserved,
        'inTransit',b.in_transit_in,
        'balanceVersion',b.version,
        'reorderPoint',coalesce(il.reorder_point,0),
        'parLevel',il.par_level,
        'consumptionMode',coalesce(i.consumption_mode,'whole_pack'),
        'defaultConsumeQuantity',i.default_consume_quantity,
        'expiryTracking',coalesce(i.expiry_tracking,false),
        'defaultShelfLifeDays',i.default_shelf_life_days,
        'expiryAlertDays',coalesce(i.expiry_alert_days,0),
        'updatedAt',b.updated_at
      ) as row_data
    from public.inventory_balances b
    join public.inventory_items i
      on i.organization_id=b.organization_id and i.id=b.item_id
    left join public.inventory_item_locations il
      on il.organization_id=b.organization_id
     and il.location_id=b.location_id
     and il.item_id=b.item_id
     and il.active=true
    where b.organization_id=v_org
      and b.location_id=p_location_id
      and (
        v_search=''
        or lower(coalesce(i.name,'')) like '%'||v_search||'%'
        or lower(coalesce(i.sku,'')) like '%'||v_search||'%'
        or lower(coalesce(i.barcode,'')) like '%'||v_search||'%'
      )
    order by b.updated_at desc
    limit v_limit
  ) rows;

  return jsonb_build_object(
    'status','ok',
    'data',jsonb_build_object('locationId',p_location_id,'items',v_items)
  );
end;
$$;

revoke all on function public.aora_inventory_authorize_fast_read(text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_session_overview(text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_session_stock(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.aora_inventory_authorize_fast_read(text,text,text) to service_role;
grant execute on function public.aora_inventory_session_overview(text,text) to service_role;
grant execute on function public.aora_inventory_session_stock(text,text,text,integer) to service_role;
