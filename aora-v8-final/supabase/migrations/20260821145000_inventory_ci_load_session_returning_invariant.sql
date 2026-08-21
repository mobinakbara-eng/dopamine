-- Verify each generated CI session token against the exact bytea returned by
-- its INSERT. This avoids any aggregate/planner ambiguity while keeping the
-- token/hash pair atomic and service-only.
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
  v_saved_hash bytea;
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
    ) returning token_hash into v_saved_hash;
    if v_saved_hash<>digest(v_token,'sha256') then
      raise exception 'inventory_ci_session_hash_invariant';
    end if;
    v_tokens:=v_tokens||jsonb_build_array(v_token);
    v_inserted:=v_inserted+1;
  end loop;

  if v_inserted<>p_count or jsonb_array_length(v_tokens)<>p_count then
    raise exception 'inventory_ci_session_count_invariant';
  end if;

  return jsonb_build_object(
    'sessionTokens',v_tokens,
    'count',v_inserted,
    'verifiedCount',v_inserted,
    'workspaceSlug',v_slug
  );
end;
$$;

revoke all on function public.aora_inventory_ci_create_load_sessions(uuid,text,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.aora_inventory_ci_create_load_sessions(uuid,text,text,integer,text,integer) to service_role;
