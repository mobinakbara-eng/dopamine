create or replace function public.aora_inventory_ci_create_virtual_users(
  p_organization_id uuid,
  p_location_id text,
  p_count integer,
  p_run_id text,
  p_run_attempt integer,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_slug text;
  v_tokens jsonb:='[]'::jsonb;
  v_subjects jsonb:='[]'::jsonb;
  v_subject text;
  v_token text;
  v_active integer;
  v_permission_count integer;
  i integer;
begin
  if p_count<1 or p_count>100
     or p_run_id !~ '^[0-9]+$'
     or p_run_attempt<1
     or nullif(trim(p_location_id),'') is null
     or nullif(trim(p_created_by),'') is null then
    raise exception 'inventory_ci_virtual_user_parameters_invalid';
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

  perform 1
  from public.locations
  where organization_id=p_organization_id
    and id=p_location_id
    and active=true
    and deleted_at is null;
  if not found then raise exception 'inventory_ci_location_not_found'; end if;

  for i in 1..p_count loop
    v_subject:=format('qa_invload_%s_%s_%s',p_run_id,p_run_attempt,lpad(i::text,3,'0'));

    insert into public.admins(organization_id,id,name,role,payload)
    values(
      p_organization_id,
      v_subject,
      'QA Inventory User '||lpad(i::text,3,'0'),
      'Manager',
      jsonb_build_object(
        'id',v_subject,
        'name','QA Inventory User '||lpad(i::text,3,'0'),
        'role','Manager',
        'scope','manager',
        'active',true,
        'status','active',
        'locationIds',jsonb_build_array(p_location_id),
        'ciLoadUser',true
      )
    );

    insert into public.manager_location_access(organization_id,manager_id,location_id,created_by)
    values(p_organization_id,v_subject,p_location_id,p_created_by);

    insert into public.inventory_permission_grants(
      organization_id,subject_type,subject_id,location_id,permission,granted_by
    ) values
      (p_organization_id,'admin',v_subject,p_location_id,'view',p_created_by),
      (p_organization_id,'admin',v_subject,p_location_id,'consume',p_created_by);

    v_token:=encode(gen_random_bytes(32),'hex');
    insert into public.app_sessions(
      organization_id,role,subject_id,location_id,token_hash,expires_at
    ) values(
      p_organization_id,'admin',v_subject,p_location_id,
      digest(v_token,'sha256'),clock_timestamp()+interval '1 hour'
    );

    v_tokens:=v_tokens||jsonb_build_array(v_token);
    v_subjects:=v_subjects||jsonb_build_array(v_subject);
  end loop;

  select count(*) into v_active
  from public.app_sessions s
  where s.organization_id=p_organization_id
    and s.role='admin'
    and s.subject_id in (select jsonb_array_elements_text(v_subjects))
    and s.revoked_at is null
    and s.expires_at>clock_timestamp();
  if v_active<>p_count then raise exception 'inventory_ci_virtual_user_session_invariant'; end if;

  select count(*) into v_permission_count
  from public.inventory_permission_grants g
  where g.organization_id=p_organization_id
    and g.subject_type='admin'
    and g.subject_id in (select jsonb_array_elements_text(v_subjects))
    and g.location_id=p_location_id
    and g.permission in ('view','consume');
  if v_permission_count<>(p_count*2) then raise exception 'inventory_ci_virtual_user_permission_invariant'; end if;

  return jsonb_build_object(
    'workspaceSlug',v_slug,
    'count',p_count,
    'sessionTokens',v_tokens,
    'subjectIds',v_subjects
  );
end;
$$;

revoke all on function public.aora_inventory_ci_create_virtual_users(uuid,text,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_ci_create_virtual_users(uuid,text,integer,text,integer,text) to service_role;
