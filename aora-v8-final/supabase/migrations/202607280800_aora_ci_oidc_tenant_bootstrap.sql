create or replace function public.aora_bootstrap_ci_tenant(
  p_slug text,
  p_name text,
  p_run_id text,
  p_run_attempt integer,
  p_state jsonb,
  p_credentials jsonb,
  p_kiosk_id text,
  p_kiosk_pin text,
  p_kiosk_name text,
  p_location_id text,
  p_manager_id text,
  p_invitation_id text,
  p_invitation_token_hash text,
  p_invitation_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org_id uuid;
  v_existing uuid;
  v_existing_run text;
  credential jsonb;
begin
  if p_slug !~ '^aora-ci-[a-z0-9-]{6,54}$'
     or p_run_id !~ '^[0-9]+$'
     or p_run_attempt < 1
     or coalesce(p_state #>> '{meta,ciRunId}','') <> p_run_id
     or coalesce((p_state #>> '{meta,ciRunAttempt}')::integer,0) <> p_run_attempt
     or jsonb_typeof(p_credentials) <> 'array'
     or length(p_kiosk_pin) < 6
     or p_invitation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_ci_bootstrap_parameters';
  end if;

  select organization.id, snapshot.state #>> '{meta,ciRunId}'
  into v_existing, v_existing_run
  from public.organizations organization
  left join public.workspace_snapshots snapshot on snapshot.organization_id=organization.id
  where organization.slug=p_slug
  for update of organization;

  if v_existing is not null then
    if v_existing_run is distinct from p_run_id then raise exception 'ci_slug_collision'; end if;
    delete from public.organizations where id=v_existing;
  end if;

  insert into public.organizations(slug,name,timezone,plan,status,billing_email)
  values(p_slug,p_name,'Europe/Berlin','staging','active',null)
  returning id into v_org_id;

  insert into public.workspace_snapshots(organization_id,revision,state,updated_at)
  values(v_org_id,1,p_state,clock_timestamp());

  perform public.project_workspace_state(v_org_id,p_state);

  for credential in select value from jsonb_array_elements(p_credentials)
  loop
    if coalesce(credential->>'subjectRole','') not in ('admin','employee')
       or coalesce(credential->>'subjectId','')=''
       or coalesce(credential->>'email','')=''
       or coalesce(credential->>'salt','') !~ '^[0-9a-f]{32}$'
       or coalesce(credential->>'passwordHash','') !~ '^[0-9a-f]{64}$'
       or coalesce((credential->>'iterations')::integer,0) < 210000 then
      raise exception 'invalid_ci_credential';
    end if;
    insert into public.aora_v8_final_credentials(
      organization_id,subject_role,subject_id,email,salt,password_hash,iterations,active
    ) values(
      v_org_id,credential->>'subjectRole',credential->>'subjectId',lower(credential->>'email'),
      credential->>'salt',credential->>'passwordHash',(credential->>'iterations')::integer,true
    );
  end loop;

  insert into public.demo_identities(organization_id,role,subject_id,display_name,location_id,pin_hash,active)
  values(v_org_id,'kiosk',p_kiosk_id,p_kiosk_name,p_location_id,crypt(p_kiosk_pin,gen_salt('bf')),true);

  insert into public.manager_location_access(organization_id,manager_id,location_id,created_by)
  values(v_org_id,p_manager_id,p_location_id,'github-oidc-ci')
  on conflict(organization_id,manager_id,location_id) do nothing;

  insert into public.aora_v8_final_invitation_tokens(organization_id,invitation_id,token_hash,expires_at)
  values(v_org_id,p_invitation_id,p_invitation_token_hash,p_invitation_expires_at);

  insert into public.retention_policies(organization_id,updated_by)
  values(v_org_id,'github-oidc-ci');

  insert into public.subscriptions(organization_id,plan_code,status,seats,locations,trial_ends_at)
  values(v_org_id,'pilot','trial',10,1,clock_timestamp()+interval '1 day');

  insert into public.workspace_changes(organization_id,revision,changed_at)
  values(v_org_id,1,clock_timestamp())
  on conflict(organization_id) do update set revision=excluded.revision,changed_at=excluded.changed_at;

  return v_org_id;
end;
$$;

create or replace function public.aora_cleanup_ci_tenant(p_slug text,p_run_id text,p_run_attempt integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
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
    and snapshot.state #>> '{meta,ciRunId}'=p_run_id
    and coalesce((snapshot.state #>> '{meta,ciRunAttempt}')::integer,0)=p_run_attempt
  for update of organization;

  if v_org_id is null then return false; end if;
  delete from public.organizations where id=v_org_id;
  return true;
end;
$$;

revoke all on function public.aora_bootstrap_ci_tenant(text,text,text,integer,jsonb,jsonb,text,text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.aora_bootstrap_ci_tenant(text,text,text,integer,jsonb,jsonb,text,text,text,text,text,text,text,timestamptz) to service_role;
revoke all on function public.aora_cleanup_ci_tenant(text,text,integer) from public, anon, authenticated;
grant execute on function public.aora_cleanup_ci_tenant(text,text,integer) to service_role;
