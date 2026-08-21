begin;

-- Lean authorization path for high-frequency manager/owner inventory reads.
-- It preserves session, organization, location, permission and feature checks,
-- but avoids materializing all locations/permissions/features for every dashboard request.
create or replace function public.aora_inventory_fast_authorize(
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
  v_org uuid;
  v_subject text;
  v_session_role text;
  v_access_role text;
  v_feature boolean:=false;
begin
  if p_token is null or length(p_token)<>64 or nullif(trim(p_location_id),'') is null then
    return jsonb_build_object('status','invalid_session');
  end if;

  select s.organization_id,s.subject_id,s.role
    into v_org,v_subject,v_session_role
  from public.app_sessions s
  where s.token_hash=digest(p_token,'sha256')
    and s.revoked_at is null
    and s.expires_at>clock_timestamp()
  limit 1;
  if not found then return jsonb_build_object('status','invalid_session'); end if;

  if v_session_role<>'admin' then
    if v_session_role='employee' then return jsonb_build_object('status','employee_action_forbidden'); end if;
    return jsonb_build_object('status','inventory_forbidden');
  end if;

  perform 1 from public.organizations o where o.id=v_org and o.status='active';
  if not found then return jsonb_build_object('status','organization_inactive'); end if;

  select case when a.payload->>'scope'='owner' then 'owner' else 'manager' end
    into v_access_role
  from public.admins a
  where a.organization_id=v_org
    and a.id=v_subject
    and a.deleted_at is null
    and coalesce((a.payload->>'active')::boolean,true)=true
    and coalesce(a.payload->>'status','')<>'revoked'
  limit 1;
  if not found then return jsonb_build_object('status','admin_inactive'); end if;

  perform 1 from public.locations l
  where l.organization_id=v_org and l.id=p_location_id and l.active=true and l.deleted_at is null;
  if not found then return jsonb_build_object('status','location_forbidden'); end if;

  if v_access_role='manager' then
    perform 1 from public.manager_location_access a
    where a.organization_id=v_org and a.manager_id=v_subject and a.location_id=p_location_id;
    if not found then return jsonb_build_object('status','location_forbidden'); end if;

    perform 1 from public.inventory_permission_grants g
    where g.organization_id=v_org and g.subject_type='admin' and g.subject_id=v_subject
      and g.location_id=p_location_id and g.permission=p_permission;
    if not found then return jsonb_build_object('status','inventory_permission_forbidden'); end if;
  end if;

  select coalesce(
    (select f.enabled from public.feature_flags f
      where f.organization_id=v_org and f.flag_key='inventory_v1' and f.location_id=p_location_id limit 1),
    (select f.enabled from public.feature_flags f
      where f.organization_id=v_org and f.flag_key='inventory_v1' and f.location_id is null limit 1),
    false
  ) into v_feature;
  if not v_feature then return jsonb_build_object('status','feature_disabled'); end if;

  return jsonb_build_object(
    'status','ok','organizationId',v_org,'subjectId',v_subject,'accessRole',v_access_role
  );
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
  v_data jsonb;
begin
  v_ctx:=public.aora_inventory_fast_authorize(p_token,p_location_id,'view');
  if coalesce(v_ctx->>'status','')<>'ok' then return v_ctx; end if;
  v_data:=public.aora_inventory_read_overview((v_ctx->>'organizationId')::uuid,p_location_id);
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
  v_ctx:=public.aora_inventory_fast_authorize(p_token,p_location_id,'view');
  if coalesce(v_ctx->>'status','')<>'ok' then return v_ctx; end if;
  v_org:=(v_ctx->>'organizationId')::uuid;

  select coalesce(jsonb_agg(row_data order by updated_at desc),'[]'::jsonb)
  into v_items
  from (
    select b.updated_at,
      jsonb_build_object(
        'id',i.id,'sku',i.sku,'barcode',i.barcode,'name',i.name,'base_uom',i.base_uom,
        'category',i.category,'active',i.active,'version',i.version,
        'consumption_mode',i.consumption_mode,'default_consume_quantity',i.default_consume_quantity,
        'expiry_tracking',i.expiry_tracking,'default_shelf_life_days',i.default_shelf_life_days,
        'expiry_alert_days',i.expiry_alert_days,'itemId',b.item_id,'onHand',b.on_hand,
        'reserved',b.reserved,'inTransit',b.in_transit_in,'balanceVersion',b.version,
        'reorderPoint',coalesce(il.reorder_point,0),'parLevel',il.par_level,
        'consumptionMode',coalesce(i.consumption_mode,'whole_pack'),
        'defaultConsumeQuantity',i.default_consume_quantity,'expiryTracking',coalesce(i.expiry_tracking,false),
        'defaultShelfLifeDays',i.default_shelf_life_days,'expiryAlertDays',coalesce(i.expiry_alert_days,0),
        'updatedAt',b.updated_at
      ) as row_data
    from public.inventory_balances b
    join public.inventory_items i on i.organization_id=b.organization_id and i.id=b.item_id
    left join public.inventory_item_locations il
      on il.organization_id=b.organization_id and il.location_id=b.location_id and il.item_id=b.item_id and il.active=true
    where b.organization_id=v_org and b.location_id=p_location_id
      and (v_search='' or lower(coalesce(i.name,'')) like '%'||v_search||'%'
        or lower(coalesce(i.sku,'')) like '%'||v_search||'%'
        or lower(coalesce(i.barcode,'')) like '%'||v_search||'%')
    order by b.updated_at desc
    limit v_limit
  ) rows;
  return jsonb_build_object('status','ok','data',jsonb_build_object('locationId',p_location_id,'items',v_items));
end;
$$;

create or replace function public.aora_inventory_session_movements(
  p_token text,
  p_location_id text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_ctx jsonb;
  v_org uuid;
  v_limit integer:=least(200,greatest(1,coalesce(p_limit,100)));
  v_rows jsonb;
begin
  v_ctx:=public.aora_inventory_fast_authorize(p_token,p_location_id,'view');
  if coalesce(v_ctx->>'status','')<>'ok' then return v_ctx; end if;
  v_org:=(v_ctx->>'organizationId')::uuid;

  select coalesce(jsonb_agg(row_data order by occurred_at desc),'[]'::jsonb)
  into v_rows
  from (
    select m.occurred_at,
      jsonb_build_object(
        'id',m.id,'item_id',m.item_id,'movement_type',m.movement_type,
        'quantity_delta',m.quantity_delta,'reason_code',m.reason_code,
        'reference_type',m.reference_type,'reference_id',m.reference_id,'actor_id',m.actor_id,
        'occurred_at',m.occurred_at,'quantityDelta',m.quantity_delta,
        'item',case when i.id is null then null else jsonb_build_object('id',i.id,'name',i.name,'sku',i.sku,'base_uom',i.base_uom) end
      ) row_data
    from public.inventory_movements m
    left join public.inventory_items i on i.organization_id=m.organization_id and i.id=m.item_id
    where m.organization_id=v_org and m.location_id=p_location_id
    order by m.occurred_at desc,m.id desc
    limit v_limit
  ) rows;
  return jsonb_build_object('status','ok','data',jsonb_build_object('locationId',p_location_id,'movements',v_rows));
end;
$$;

create or replace function public.aora_inventory_session_replenishment(
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
  v_enabled boolean:=false;
  v_rows jsonb;
begin
  v_ctx:=public.aora_inventory_fast_authorize(p_token,p_location_id,'procurement');
  if coalesce(v_ctx->>'status','')<>'ok' then return v_ctx; end if;
  v_org:=(v_ctx->>'organizationId')::uuid;

  select coalesce(
    (select f.enabled from public.feature_flags f where f.organization_id=v_org and f.flag_key='replenishment_suggestions' and f.location_id=p_location_id limit 1),
    (select f.enabled from public.feature_flags f where f.organization_id=v_org and f.flag_key='replenishment_suggestions' and f.location_id is null limit 1),
    false
  ) into v_enabled;
  if not v_enabled then return jsonb_build_object('status','feature_disabled'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id',r.item_id,'below_threshold',r.below_threshold,'episode_id',r.episode_id,
    'opened_at',r.opened_at,'suggested_base_quantity',r.suggested_base_quantity,
    'updated_at',r.updated_at,'suggestedQuantity',r.suggested_base_quantity
  ) order by r.opened_at),'[]'::jsonb)
  into v_rows
  from public.inventory_replenishment_state r
  where r.organization_id=v_org and r.location_id=p_location_id and r.below_threshold=true;

  return jsonb_build_object('status','ok','data',jsonb_build_object('suggestions',v_rows));
end;
$$;

revoke all on function public.aora_inventory_fast_authorize(text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_session_overview(text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_session_stock(text,text,text,integer) from public,anon,authenticated;
revoke all on function public.aora_inventory_session_movements(text,text,integer) from public,anon,authenticated;
revoke all on function public.aora_inventory_session_replenishment(text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_fast_authorize(text,text,text) to service_role;
grant execute on function public.aora_inventory_session_overview(text,text) to service_role;
grant execute on function public.aora_inventory_session_stock(text,text,text,integer) to service_role;
grant execute on function public.aora_inventory_session_movements(text,text,integer) to service_role;
grant execute on function public.aora_inventory_session_replenishment(text,text) to service_role;

commit;
