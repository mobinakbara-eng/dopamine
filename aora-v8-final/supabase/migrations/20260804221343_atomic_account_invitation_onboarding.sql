create table if not exists public.pilot_onboarding_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);

alter table public.pilot_onboarding_codes enable row level security;
revoke all on public.pilot_onboarding_codes from public, anon, authenticated;
grant all on public.pilot_onboarding_codes to service_role;

alter table public.demo_identities
  add column if not exists pin_expires_at timestamptz;

create or replace function public.aora_set_kiosk_pin_expiry()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.role = 'kiosk' and new.pin_hash is not null
     and (tg_op = 'INSERT' or new.pin_hash is distinct from old.pin_hash) then
    new.pin_expires_at := clock_timestamp() + interval '24 hours';
  end if;
  return new;
end;
$function$;

drop trigger if exists aora_kiosk_pin_expiry_before_write on public.demo_identities;
create trigger aora_kiosk_pin_expiry_before_write
before insert or update of pin_hash on public.demo_identities
for each row execute function public.aora_set_kiosk_pin_expiry();

create or replace function public.aora_commit_account_deactivation(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_actor_role text,
  p_actor_id text,
  p_subject_role text,
  p_subject_id text,
  p_event_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_subject_role not in ('admin', 'employee') or nullif(p_subject_id, '') is null then
    raise exception 'invalid_account_deactivation';
  end if;

  v_revision := public.aora_commit_workspace_state(
    p_organization_id, p_expected_revision, p_state, p_actor_role, p_actor_id,
    'DEACTIVATE_ACCOUNT', coalesce(p_event_payload, '{}'::jsonb),
    p_subject_role, p_subject_id, nullif(p_event_payload->>'locationId', '')
  );

  update public.app_sessions
  set revoked_at = v_now
  where organization_id = p_organization_id
    and role = p_subject_role
    and subject_id = p_subject_id
    and revoked_at is null;

  update public.aora_v8_final_credentials
  set active = false, updated_at = v_now
  where organization_id = p_organization_id
    and subject_role = p_subject_role
    and subject_id = p_subject_id;

  update public.demo_identities
  set active = false
  where organization_id = p_organization_id
    and role = p_subject_role
    and subject_id = p_subject_id;

  return v_revision;
end;
$function$;

revoke all on function public.aora_commit_account_deactivation(uuid,bigint,jsonb,text,text,text,text,jsonb)
from public, anon, authenticated;
grant execute on function public.aora_commit_account_deactivation(uuid,bigint,jsonb,text,text,text,text,jsonb)
to service_role;

create or replace function public.aora_commit_invitation_change(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_actor_role text,
  p_actor_id text,
  p_event_type text,
  p_event_payload jsonb,
  p_invitation_id text,
  p_token_hash text default null,
  p_expires_at timestamptz default null,
  p_revoke boolean default false
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_event_type not in ('INVITE_MANAGER', 'CREATE_EMPLOYEE_ACCOUNT', 'RESEND_INVITATION', 'REVOKE_INVITATION')
     or nullif(p_invitation_id, '') is null
     or (not p_revoke and (p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= v_now)) then
    raise exception 'invalid_invitation_change';
  end if;

  v_revision := public.aora_commit_workspace_state(
    p_organization_id, p_expected_revision, p_state, p_actor_role, p_actor_id,
    p_event_type, coalesce(p_event_payload, '{}'::jsonb), 'invitation', p_invitation_id, null
  );

  if p_revoke then
    update public.aora_v8_final_invitation_tokens
    set revoked_at = v_now, updated_at = v_now
    where organization_id = p_organization_id
      and invitation_id = p_invitation_id;
  else
    insert into public.aora_v8_final_invitation_tokens(
      organization_id, invitation_id, token_hash, expires_at, used_at, revoked_at, created_at, updated_at
    ) values (
      p_organization_id, p_invitation_id, p_token_hash, p_expires_at, null, null, v_now, v_now
    )
    on conflict (organization_id, invitation_id) do update
    set token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        used_at = null,
        revoked_at = null,
        updated_at = excluded.updated_at;
  end if;

  return v_revision;
end;
$function$;

revoke all on function public.aora_commit_invitation_change(uuid,bigint,jsonb,text,text,text,jsonb,text,text,timestamptz,boolean)
from public, anon, authenticated;
grant execute on function public.aora_commit_invitation_change(uuid,bigint,jsonb,text,text,text,jsonb,text,text,timestamptz,boolean)
to service_role;

create or replace function public.aora_provision_pilot_organization(
  p_code_hash text,
  p_slug text,
  p_name text,
  p_timezone text,
  p_billing_email text,
  p_state jsonb,
  p_company jsonb,
  p_invitation_id text,
  p_invitation_token_hash text,
  p_invitation_expires_at timestamptz,
  p_created_by text default 'pilot-onboarding'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  v_rule_set uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_slug !~ '^[a-z0-9][a-z0-9-]{2,62}$'
     or nullif(p_name, '') is null
     or p_state is null
     or p_invitation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_onboarding_payload';
  end if;

  perform 1 from public.pilot_onboarding_codes
  where code_hash = p_code_hash and used_at is null and expires_at > v_now
  for update;
  if not found then raise exception 'onboarding_code_invalid'; end if;

  insert into public.organizations(slug,name,timezone,plan,status,billing_email,created_at,updated_at)
  values(p_slug,p_name,coalesce(nullif(p_timezone,''),'Europe/Berlin'),'pilot','active',lower(p_billing_email),v_now,v_now)
  returning id into v_org;
  insert into public.workspace_snapshots(organization_id,revision,state,updated_at) values(v_org,1,p_state,v_now);
  insert into public.workspace_changes(organization_id,revision,changed_at) values(v_org,1,v_now);
  insert into public.workspace_events(organization_id,sequence,actor_role,actor_subject_id,event_type,event_payload,created_at,request_id)
  values(v_org,1,'system',p_created_by,'ORGANIZATION_PROVISIONED',jsonb_build_object('slug',p_slug),v_now,gen_random_uuid()::text);
  insert into public.companies(organization_id,name,business_type,billing_email,language,timezone,address)
  values(v_org,p_name,p_company->>'businessType',lower(p_billing_email),coalesce(p_company->>'language','de'),coalesce(nullif(p_timezone,''),'Europe/Berlin'),coalesce(p_company->'address','{}'::jsonb));
  insert into public.aora_v8_final_invitation_tokens(organization_id,invitation_id,token_hash,expires_at,created_at,updated_at)
  values(v_org,p_invitation_id,lower(p_invitation_token_hash),p_invitation_expires_at,v_now,v_now);
  insert into public.retention_policies(organization_id,updated_by) values(v_org,p_created_by);
  insert into public.subscriptions(organization_id,plan_code,status,seats,locations,trial_ends_at)
  values(v_org,'pilot','trial',10,1,v_now+interval '60 days');
  insert into public.work_rule_sets(organization_id,name,effective_from,version,active,timezone,created_by)
  values(v_org,'Pilot Deutschland Basis',v_now::date,1,true,coalesce(nullif(p_timezone,''),'Europe/Berlin'),p_created_by)
  returning id into v_rule_set;
  insert into public.work_rules(organization_id,rule_set_id,rule_type,threshold_minutes,severity,parameters,active) values
  (v_org,v_rule_set,'INACTIVE_EMPLOYEE',null,'block','{}',true),
  (v_org,v_rule_set,'SHIFT_OVERLAP',null,'block','{}',true),
  (v_org,v_rule_set,'MAX_DAILY_WORK',600,'block','{}',true),
  (v_org,v_rule_set,'MIN_BREAK_AFTER_6H',30,'block','{"afterMinutes":360}',true),
  (v_org,v_rule_set,'MIN_BREAK_AFTER_9H',45,'block','{"afterMinutes":540}',true),
  (v_org,v_rule_set,'MIN_REST_BETWEEN_SHIFTS',660,'confirm','{"allowException":true}',true),
  (v_org,v_rule_set,'OVERNIGHT_SHIFT',null,'hint','{}',true),
  (v_org,v_rule_set,'DST_TRANSITION',null,'confirm','{"allowException":true}',true),
  (v_org,v_rule_set,'MAX_WEEKLY_WORK',2880,'hint','{"pilotOnly":true}',true),
  (v_org,v_rule_set,'MINOR_EMPLOYEE',null,'hint','{"inactiveUntilBirthDateVerified":true}',true);
  update public.pilot_onboarding_codes set used_at=v_now where code_hash=p_code_hash;
  return v_org;
exception when unique_violation then
  raise exception 'organization_or_invitation_exists';
end;
$function$;

revoke all on function public.aora_provision_pilot_organization(text,text,text,text,text,jsonb,jsonb,text,text,timestamptz,text)
from public, anon, authenticated;
grant execute on function public.aora_provision_pilot_organization(text,text,text,text,text,jsonb,jsonb,text,text,timestamptz,text)
to service_role;

create or replace function public.aora_provision_pilot_organization_v2(
  p_code_hash text,
  p_slug text,
  p_name text,
  p_timezone text,
  p_billing_email text,
  p_state jsonb,
  p_company jsonb,
  p_invitation_id text,
  p_invitation_token_hash text,
  p_invitation_expires_at timestamptz,
  p_created_by text,
  p_manager_id text,
  p_kiosk_device_id text,
  p_kiosk_name text,
  p_kiosk_location_id text,
  p_kiosk_activation_code text,
  p_kiosk_activation_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_org uuid;
begin
  if p_kiosk_device_id !~ '^kiosk_[0-9a-f-]{36}$'
     or p_kiosk_activation_code !~ '^[0-9]{8}$'
     or p_kiosk_activation_expires_at <= clock_timestamp()
     or nullif(p_manager_id, '') is null
     or nullif(p_kiosk_location_id, '') is null then
    raise exception 'invalid_kiosk_onboarding_payload';
  end if;

  v_org := public.aora_provision_pilot_organization(
    p_code_hash,p_slug,p_name,p_timezone,p_billing_email,p_state,p_company,
    p_invitation_id,p_invitation_token_hash,p_invitation_expires_at,p_created_by
  );

  insert into public.demo_identities(
    organization_id,role,subject_id,display_name,location_id,pin_hash,pin_expires_at,active
  ) values (
    v_org,'kiosk',p_kiosk_device_id,p_kiosk_name,p_kiosk_location_id,
    crypt(p_kiosk_activation_code,gen_salt('bf')),p_kiosk_activation_expires_at,true
  )
  on conflict (organization_id,role,subject_id) do update
  set display_name=excluded.display_name, location_id=excluded.location_id,
      pin_hash=excluded.pin_hash, pin_expires_at=excluded.pin_expires_at, active=true;

  insert into public.manager_location_access(organization_id,manager_id,location_id,created_by)
  values(v_org,p_manager_id,p_kiosk_location_id,p_created_by)
  on conflict (organization_id,manager_id,location_id) do nothing;

  return v_org;
end;
$function$;

revoke all on function public.aora_provision_pilot_organization_v2(text,text,text,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.aora_provision_pilot_organization_v2(text,text,text,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,text,timestamptz)
to service_role;

create or replace function public.validate_demo_session(p_token text)
returns table(session_id uuid, organization_id uuid, role text, subject_id text, location_id text, display_name text, expires_at timestamptz)
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
  update public.app_sessions set last_seen_at=now()
  where token_hash=extensions.digest(p_token,'sha256') and revoked_at is null and expires_at>now()
  returning id,organization_id,role,subject_id,location_id,
    (select display_name from public.demo_identities i where i.organization_id=app_sessions.organization_id and i.role=app_sessions.role and i.subject_id=app_sessions.subject_id),
    expires_at;
$function$;

create or replace function public.demo_logout(p_token text)
returns void
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
  update public.app_sessions set revoked_at=now() where token_hash=extensions.digest(p_token,'sha256');
$function$;

revoke all on function public.validate_demo_session(text), public.demo_logout(text)
from public, anon, authenticated;
grant execute on function public.validate_demo_session(text), public.demo_logout(text)
to service_role;

create or replace function public.demo_login(
  p_workspace_slug text,
  p_role text,
  p_subject_id text,
  p_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_identity public.demo_identities%rowtype;
  v_token text;
  v_expires timestamptz;
begin
  select identity.* into v_identity
  from public.demo_identities identity
  join public.organizations organization on organization.id=identity.organization_id
  where organization.slug=p_workspace_slug and organization.status='active'
    and identity.role=p_role and identity.subject_id=p_subject_id and identity.active=true
  for update of identity;
  if not found then raise exception 'Zugang wurde nicht gefunden oder ist deaktiviert.'; end if;

  if p_role='kiosk' and exists(
    select 1 from public.kiosk_devices device
    where device.organization_id=v_identity.organization_id and device.id=p_subject_id
      and (device.active=false or device.locked=true)
  ) then raise exception 'Dieses Kiosk-Gerät ist gesperrt oder deaktiviert.'; end if;

  if p_role='kiosk' and v_identity.pin_expires_at is not null and v_identity.pin_expires_at <= now() then
    raise exception 'Der Aktivierungscode ist abgelaufen. Bitte einen neuen Code erzeugen.';
  end if;
  if v_identity.pin_hash is null or p_pin is null or crypt(p_pin,v_identity.pin_hash)<>v_identity.pin_hash then
    raise exception 'Das Passwort ist nicht korrekt.';
  end if;

  if p_role='kiosk' then
    update public.demo_identities
    set pin_hash=null, pin_expires_at=null
    where id=v_identity.id;
  end if;

  v_token:=encode(gen_random_bytes(32),'hex');
  v_expires:=now()+case when p_role='kiosk' then interval '30 days' else interval '12 hours' end;
  insert into public.app_sessions(organization_id,role,subject_id,location_id,token_hash,expires_at)
  values(v_identity.organization_id,p_role,p_subject_id,v_identity.location_id,digest(v_token,'sha256'),v_expires);
  return jsonb_build_object(
    'token',v_token,'organizationId',v_identity.organization_id,'role',p_role,'subjectId',p_subject_id,
    'employeeId',case when p_role='employee' then p_subject_id end,
    'adminId',case when p_role='admin' then p_subject_id end,
    'deviceId',case when p_role='kiosk' then p_subject_id end,
    'locationId',v_identity.location_id,'expiresAt',v_expires
  );
end;
$function$;

revoke all on function public.demo_login(text,text,text,text) from public,anon,authenticated;
grant execute on function public.demo_login(text,text,text,text) to service_role;
