create or replace function public.aora_inventory_resolve_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_session public.app_sessions%rowtype;
  v_org_name text;
  v_admin public.admins%rowtype;
  v_employee public.employees%rowtype;
  v_access_role text;
  v_location_ids text[]:='{}'::text[];
  v_permissions jsonb:='[]'::jsonb;
  v_features jsonb:='[]'::jsonb;
begin
  if p_token is null or length(p_token)<>64 then
    return jsonb_build_object('status','invalid_session');
  end if;

  select * into v_session
  from public.app_sessions
  where token_hash=digest(p_token,'sha256')
    and revoked_at is null
    and expires_at>clock_timestamp()
  limit 1;
  if not found then return jsonb_build_object('status','invalid_session'); end if;

  if v_session.last_seen_at<clock_timestamp()-interval '60 seconds' then
    update public.app_sessions
    set last_seen_at=clock_timestamp()
    where id=v_session.id
      and last_seen_at<clock_timestamp()-interval '60 seconds';
  end if;

  select name into v_org_name
  from public.organizations
  where id=v_session.organization_id and status='active';
  if not found then return jsonb_build_object('status','organization_inactive'); end if;

  if v_session.role='admin' then
    select * into v_admin
    from public.admins
    where organization_id=v_session.organization_id
      and id=v_session.subject_id
      and deleted_at is null;
    if not found
       or coalesce((v_admin.payload->>'active')::boolean,true)=false
       or coalesce(v_admin.payload->>'status','')='revoked' then
      return jsonb_build_object('status','admin_inactive');
    end if;

    v_access_role:=case when v_admin.payload->>'scope'='owner' then 'owner' else 'manager' end;
    if v_access_role='owner' then
      select coalesce(array_agg(id order by id),'{}'::text[]) into v_location_ids
      from public.locations
      where organization_id=v_session.organization_id
        and active=true
        and deleted_at is null;
    else
      select coalesce(array_agg(location_id order by location_id),'{}'::text[]) into v_location_ids
      from public.manager_location_access
      where organization_id=v_session.organization_id
        and manager_id=v_session.subject_id;

      select coalesce(jsonb_agg(jsonb_build_object('locationId',location_id,'permission',permission) order by location_id,permission),'[]'::jsonb)
      into v_permissions
      from public.inventory_permission_grants
      where organization_id=v_session.organization_id
        and subject_type='admin'
        and subject_id=v_session.subject_id;
    end if;
  elsif v_session.role='employee' then
    select * into v_employee
    from public.employees
    where organization_id=v_session.organization_id
      and id=v_session.subject_id;
    if not found or not v_employee.active or v_employee.deleted_at is not null then
      return jsonb_build_object('status','employee_inactive');
    end if;
    v_access_role:='employee';

    select coalesce(array_agg(distinct x.location_id order by x.location_id),'{}'::text[])
    into v_location_ids
    from (
      select v_employee.primary_location_id as location_id
      union all select v_employee.location_id
      union all
      select ela.location_id
      from public.employee_location_access ela
      where ela.organization_id=v_session.organization_id
        and ela.employee_id=v_session.subject_id
    ) x
    where x.location_id is not null and x.location_id<>'';

    select coalesce(jsonb_agg(jsonb_build_object('locationId',location_id,'permission',permission) order by location_id,permission),'[]'::jsonb)
    into v_permissions
    from public.inventory_permission_grants
    where organization_id=v_session.organization_id
      and subject_type='employee'
      and subject_id=v_session.subject_id;
  else
    return jsonb_build_object('status','inventory_forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('key',flag_key,'locationId',location_id,'enabled',enabled) order by flag_key,location_id nulls first),'[]'::jsonb)
  into v_features
  from public.feature_flags
  where organization_id=v_session.organization_id;

  return jsonb_build_object(
    'status','ok',
    'organizationId',v_session.organization_id,
    'organizationName',coalesce(v_org_name,'Aora'),
    'subjectId',v_session.subject_id,
    'accessRole',v_access_role,
    'locationIds',to_jsonb(v_location_ids),
    'permissions',v_permissions,
    'features',v_features,
    'expiresAt',v_session.expires_at
  );
end;
$$;

revoke all on function public.aora_inventory_resolve_session(text) from public,anon,authenticated;
grant execute on function public.aora_inventory_resolve_session(text) to service_role;

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
    )
    select p_organization_id,'admin',v_subject,p_location_id,p.permission,p_created_by
    from unnest(array['view','receipt','consume','waste','transfer_dispatch','transfer_receive','adjust','procurement']::text[]) p(permission);

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
    and g.permission in ('view','receipt','consume','waste','transfer_dispatch','transfer_receive','adjust','procurement');
  if v_permission_count<>(p_count*8) then raise exception 'inventory_ci_virtual_user_permission_invariant'; end if;

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
