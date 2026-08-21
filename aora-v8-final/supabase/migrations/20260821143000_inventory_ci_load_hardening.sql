-- Staging/CI hardening for the Inventory 100-user load gate.
-- This does not create or alter live tenant data. Every privileged helper below
-- validates the existing GitHub-OIDC CI tenant marker before it can act.

create or replace function public.aora_inventory_movement_immutable()
returns trigger
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
begin
  if tg_op='DELETE'
     and current_setting('aora.maintenance_cleanup',true)='on'
     and current_setting('aora.cleanup_organization_id',true)=old.organization_id::text
     and exists(
       select 1
       from public.organizations o
       join public.workspace_snapshots s on s.organization_id=o.id
       where o.id=old.organization_id
         and o.slug ~ '^aora-ci-[a-z0-9-]{6,54}$'
         and s.state #>> '{meta,tenantSource}'='github-oidc-ci'
         and s.state #>> '{meta,ciRunId}' ~ '^[0-9]+$'
         and coalesce(s.state #>> '{meta,ciRunAttempt}','') ~ '^[0-9]+$'
     ) then
    return old;
  end if;
  raise exception 'inventory_movements_are_immutable';
end;
$$;

create or replace function public.aora_inventory_ci_create_load_sessions(
  p_organization_id uuid,
  p_subject_id text,
  p_location_id text,
  p_count integer,
  p_run_id text,
  p_run_attempt integer
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_slug text;
  v_tokens jsonb:='[]'::jsonb;
  v_token text;
  v_inserted integer:=0;
  i integer;
begin
  if p_count<1 or p_count>100
     or p_run_id !~ '^[0-9]+$'
     or p_run_attempt<1
     or nullif(trim(p_subject_id),'') is null
     or nullif(trim(p_location_id),'') is null then
    raise exception 'inventory_ci_load_parameters_invalid';
  end if;

  select o.slug into v_slug
  from public.organizations o
  join public.workspace_snapshots s on s.organization_id=o.id
  where o.id=p_organization_id
    and o.slug ~ '^aora-ci-[a-z0-9-]{6,54}$'
    and s.state #>> '{meta,tenantSource}'='github-oidc-ci'
    and s.state #>> '{meta,ciRunId}'=p_run_id
    and coalesce((s.state #>> '{meta,ciRunAttempt}')::integer,0)=p_run_attempt
  for share of o;
  if v_slug is null then raise exception 'inventory_ci_tenant_not_allowed'; end if;

  perform 1 from public.admins
   where organization_id=p_organization_id and id=p_subject_id
     and deleted_at is null and coalesce((payload->>'active')::boolean,true)=true;
  if not found then raise exception 'inventory_ci_subject_not_found'; end if;

  perform 1 from public.locations
   where organization_id=p_organization_id and id=p_location_id
     and active=true and deleted_at is null;
  if not found then raise exception 'inventory_ci_location_not_found'; end if;

  for i in 1..p_count loop
    v_token:=encode(gen_random_bytes(32),'hex');
    insert into public.app_sessions(
      organization_id,role,subject_id,location_id,token_hash,expires_at
    ) values(
      p_organization_id,'admin',p_subject_id,p_location_id,
      digest(v_token,'sha256'),clock_timestamp()+interval '1 hour'
    );
    v_tokens:=v_tokens||jsonb_build_array(v_token);
    v_inserted:=v_inserted+1;
  end loop;

  if v_inserted<>p_count then raise exception 'inventory_ci_session_count_invariant'; end if;
  if (
    select count(*)
    from public.app_sessions
    where organization_id=p_organization_id
      and subject_id=p_subject_id
      and location_id=p_location_id
      and revoked_at is null
      and expires_at>clock_timestamp()
  ) < p_count then
    raise exception 'inventory_ci_session_persistence_invariant';
  end if;

  return jsonb_build_object('sessionTokens',v_tokens,'count',v_inserted,'workspaceSlug',v_slug);
end;
$$;

create or replace function public.aora_cleanup_ci_tenant(
  p_slug text,
  p_run_id text,
  p_run_attempt integer
)
returns boolean
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_org_id uuid;
begin
  if p_slug !~ '^aora-ci-[a-z0-9-]{6,54}$' or p_run_id !~ '^[0-9]+$' or p_run_attempt < 1 then
    raise exception 'invalid_ci_cleanup_parameters';
  end if;

  select organization.id into v_org_id
  from public.organizations organization
  join public.workspace_snapshots snapshot on snapshot.organization_id=organization.id
  where organization.slug=p_slug
    and snapshot.state #>> '{meta,tenantSource}'='github-oidc-ci'
    and snapshot.state #>> '{meta,ciRunId}'=p_run_id
    and coalesce((snapshot.state #>> '{meta,ciRunAttempt}')::integer,0)=p_run_attempt
  for update of organization;

  if v_org_id is null then return false; end if;

  perform set_config('aora.maintenance_cleanup','on',true);
  perform set_config('aora.cleanup_organization_id',v_org_id::text,true);

  -- Inventory was added after the original generic CI cleanup function and its
  -- tenant FKs are deliberately restrictive. Remove only rows belonging to the
  -- already-validated CI organization, child-first, before deleting the tenant.
  delete from public.inventory_stock_units where organization_id=v_org_id;
  delete from public.inventory_receipt_exceptions where organization_id=v_org_id;
  delete from public.inventory_label_print_jobs where organization_id=v_org_id;
  delete from public.inventory_goods_receipt_lines where organization_id=v_org_id;
  delete from public.inventory_goods_receipts where organization_id=v_org_id;
  delete from public.inventory_purchase_order_deliveries where organization_id=v_org_id;
  delete from public.inventory_purchase_order_lines where organization_id=v_org_id;
  delete from public.inventory_purchase_orders where organization_id=v_org_id;
  delete from public.inventory_transfer_lines where organization_id=v_org_id;
  delete from public.inventory_transfers where organization_id=v_org_id;
  delete from public.inventory_count_lines where organization_id=v_org_id;
  delete from public.inventory_counts where organization_id=v_org_id;
  delete from public.inventory_movements where organization_id=v_org_id;
  delete from public.inventory_replenishment_state where organization_id=v_org_id;
  delete from public.inventory_balances where organization_id=v_org_id;
  delete from public.inventory_supplier_items where organization_id=v_org_id;
  delete from public.inventory_item_locations where organization_id=v_org_id;
  delete from public.inventory_pack_units where organization_id=v_org_id;
  delete from public.inventory_suppliers where organization_id=v_org_id;
  delete from public.inventory_items where organization_id=v_org_id;
  delete from public.inventory_ordering_profiles where organization_id=v_org_id;
  delete from public.inventory_print_profiles where organization_id=v_org_id;
  delete from public.inventory_permission_events where organization_id=v_org_id;
  delete from public.inventory_permission_grants where organization_id=v_org_id;
  delete from public.inventory_outbox where organization_id=v_org_id;

  delete from public.organizations where id=v_org_id;
  return true;
end;
$$;

revoke all on function public.aora_inventory_movement_immutable() from public,anon,authenticated;
grant execute on function public.aora_inventory_movement_immutable() to service_role;
revoke all on function public.aora_inventory_ci_create_load_sessions(uuid,text,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.aora_inventory_ci_create_load_sessions(uuid,text,text,integer,text,integer) to service_role;
revoke all on function public.aora_cleanup_ci_tenant(text,text,integer) from public,anon,authenticated;
grant execute on function public.aora_cleanup_ci_tenant(text,text,integer) to service_role;
