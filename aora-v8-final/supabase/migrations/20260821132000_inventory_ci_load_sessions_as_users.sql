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
  v_bundle jsonb;
begin
  if p_count<1 or p_count>100
     or p_run_id !~ '^[0-9]+$'
     or p_run_attempt<1
     or nullif(trim(p_subject_id),'') is null
     or nullif(trim(p_location_id),'') is null then
    raise exception 'inventory_ci_load_parameters_invalid';
  end if;

  perform 1
  from public.admins
  where organization_id=p_organization_id
    and id=p_subject_id
    and deleted_at is null
    and coalesce((payload->>'active')::boolean,true)=true;
  if not found then raise exception 'inventory_ci_subject_not_found'; end if;

  v_bundle:=public.aora_inventory_ci_create_virtual_users(
    p_organization_id,
    p_location_id,
    p_count,
    p_run_id,
    p_run_attempt,
    p_subject_id
  );

  if coalesce((v_bundle->>'count')::integer,0)<>p_count
     or jsonb_array_length(coalesce(v_bundle->'sessionTokens','[]'::jsonb))<>p_count
     or jsonb_array_length(coalesce(v_bundle->'subjectIds','[]'::jsonb))<>p_count then
    raise exception 'inventory_ci_distinct_user_bundle_invariant';
  end if;

  return v_bundle;
end;
$$;

revoke all on function public.aora_inventory_ci_create_load_sessions(uuid,text,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.aora_inventory_ci_create_load_sessions(uuid,text,text,integer,text,integer) to service_role;
