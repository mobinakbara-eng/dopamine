begin;

create schema if not exists private;

-- Additive canonical columns. Legacy payloads and workspace snapshots remain intact.
alter table public.locations
  add column if not exists address text,
  add column if not exists country text not null default 'DE',
  add column if not exists timezone text not null default 'Europe/Berlin',
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists geofence_radius integer not null default 100,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

alter table public.employees
  add column if not exists profile_id uuid,
  add column if not exists primary_location_id text,
  add column if not exists role_title text,
  add column if not exists weekly_target_minutes integer not null default 0,
  add column if not exists vacation_allowance numeric not null default 0,
  add column if not exists hourly_cost numeric,
  add column if not exists version integer not null default 1,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

alter table public.shifts
  add column if not exists starts_at time,
  add column if not exists ends_at time,
  add column if not exists break_minutes integer not null default 0,
  add column if not exists role_required text,
  add column if not exists published_at timestamptz,
  add column if not exists confirmation_deadline timestamptz,
  add column if not exists version integer not null default 1,
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

alter table public.shift_series
  add column if not exists recurrence_rule text,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists break_minutes integer not null default 0,
  add column if not exists active boolean not null default true,
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

alter table public.shift_requests
  add column if not exists location_id text,
  add column if not exists reason text,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by text,
  add column if not exists idempotency_key uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

alter table public.task_templates
  add column if not exists category text not null default 'custom',
  add column if not exists version integer not null default 1,
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists review_required boolean not null default false,
  add column if not exists clockout_policy text not null default 'WARN_ONLY',
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

alter table public.task_template_items
  add column if not exists min_value numeric,
  add column if not exists max_value numeric,
  add column if not exists options jsonb not null default '[]'::jsonb,
  add column if not exists visibility_rule jsonb not null default '{}'::jsonb,
  add column if not exists validation_rule jsonb not null default '{}'::jsonb;

alter table public.task_instances
  add column if not exists rule_id text,
  add column if not exists template_version integer not null default 1,
  add column if not exists scheduled_for timestamptz,
  add column if not exists blocking_clockout boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

alter table public.task_assignments
  add column if not exists accepted_at timestamptz,
  add column if not exists status text not null default 'assigned';

alter table public.task_answers
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists version integer not null default 1,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.notifications
  add column if not exists location_id text,
  add column if not exists type text not null default 'general',
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists related_entity_type text,
  add column if not exists related_entity_id text,
  add column if not exists read_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists deleted_at timestamptz;

alter table public.time_entries
  add column if not exists shift_id text,
  add column if not exists start_time timestamptz,
  add column if not exists end_time timestamptz,
  add column if not exists break_minutes integer not null default 0,
  add column if not exists duration_minutes integer not null default 0,
  add column if not exists source text not null default 'legacy',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

alter table public.audit_logs
  add column if not exists location_id text,
  add column if not exists actor_type text,
  add column if not exists actor_id text,
  add column if not exists entity_type text,
  add column if not exists before_json jsonb,
  add column if not exists after_json jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Expand task status values without changing existing records.
alter table public.task_instances drop constraint if exists task_instances_status_check;
alter table public.task_instances
  add constraint task_instances_status_check
  check (status in ('open','in_progress','submitted','completed','rejected','overdue','waived','cancelled'));

alter table public.task_assignments drop constraint if exists task_assignments_status_check;
alter table public.task_assignments
  add constraint task_assignments_status_check
  check (status in ('assigned','accepted','in_progress','completed','rejected','cancelled'));

alter table public.task_templates drop constraint if exists task_templates_clockout_policy_check;
alter table public.task_templates
  add constraint task_templates_clockout_policy_check
  check (clockout_policy in ('WARN_ONLY','MANAGER_OVERRIDE','STRICT_BLOCK'));

-- Canonical task automation rules.
create table if not exists public.task_rules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id text not null,
  location_id text not null,
  template_id text not null,
  trigger_type text not null check (trigger_type in ('fixed_time','shift_start','shift_end','before_shift_end','after_shift_start','location_open','location_close','manual')),
  trigger_config jsonb not null default '{}'::jsonb,
  assignment_strategy text not null check (assignment_strategy in ('all_on_shift','one_on_shift','shift_leader','specific_employee','specific_role','first_claim','round_robin')),
  assignment_config jsonb not null default '{}'::jsonb,
  due_offset_minutes integer not null default 0,
  clockout_policy text not null default 'WARN_ONLY' check (clockout_policy in ('WARN_ONLY','MANAGER_OVERRIDE','STRICT_BLOCK')),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  delete_reason text,
  primary key (organization_id,id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id),
  foreign key (organization_id,template_id) references public.task_templates(organization_id,id)
);

create table if not exists public.task_generation_keys (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id text not null,
  scheduled_for timestamptz not null,
  employee_id text not null,
  task_instance_id text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,rule_id,scheduled_for,employee_id),
  foreign key (organization_id,rule_id) references public.task_rules(organization_id,id) on delete cascade,
  foreign key (organization_id,employee_id) references public.employees(organization_id,id) on delete cascade,
  foreign key (organization_id,task_instance_id) references public.task_instances(organization_id,id) on delete cascade
);

create table if not exists public.task_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id text not null,
  task_instance_id text not null,
  template_item_id text not null,
  uploaded_by text not null,
  storage_path text not null,
  mime_type text not null,
  file_size bigint not null check (file_size >= 0 and file_size <= 15728640),
  sha256 text not null,
  captured_at timestamptz,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  delete_reason text,
  unique (organization_id,storage_path),
  foreign key (organization_id,location_id) references public.locations(organization_id,id),
  foreign key (organization_id,task_instance_id) references public.task_instances(organization_id,id)
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_id text not null,
  channel text not null check (channel in ('in_app','web_push','email')),
  status text not null default 'pending' check (status in ('pending','sending','sent','delivered','failed','expired','cancelled')),
  attempts integer not null default 0,
  idempotency_key text not null,
  last_error text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,idempotency_key),
  unique (organization_id,notification_id,channel),
  foreign key (organization_id,notification_id) references public.notifications(organization_id,id) on delete cascade
);

create table if not exists public.feature_flag_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flag_key text not null,
  scope_type text not null check (scope_type in ('organization','location','role','employee','percentage')),
  scope_value text,
  enabled boolean not null default false,
  rollout_percentage integer not null default 100 check (rollout_percentage between 0 and 100),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id,flag_key,scope_type,scope_value)
);

create table if not exists public.scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  job_type text not null,
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  generated_count integer not null default 0,
  notification_count integer not null default 0,
  error_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  unique (job_type,scheduled_for,organization_id)
);

create table if not exists public.idempotency_records (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action text not null,
  actor_id text not null,
  idempotency_key uuid not null,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  response jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (organization_id,action,actor_id,idempotency_key)
);

-- Add scoped foreign keys after back-compatible columns exist.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='employees_primary_location_fkey') then
    alter table public.employees add constraint employees_primary_location_fkey
      foreign key (organization_id,primary_location_id) references public.locations(organization_id,id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='shift_requests_location_fkey') then
    alter table public.shift_requests add constraint shift_requests_location_fkey
      foreign key (organization_id,location_id) references public.locations(organization_id,id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='time_entries_shift_fkey') then
    alter table public.time_entries add constraint time_entries_shift_fkey
      foreign key (organization_id,shift_id) references public.shifts(organization_id,id) on delete set null;
  end if;
end $$;

create unique index if not exists shift_requests_idempotency_idx
  on public.shift_requests(organization_id,idempotency_key)
  where idempotency_key is not null;
create index if not exists shifts_calendar_range_idx
  on public.shifts(organization_id,employee_id,shift_date)
  where deleted_at is null;
create index if not exists shifts_manager_board_idx
  on public.shifts(organization_id,location_id,shift_date,status)
  where deleted_at is null;
create index if not exists task_rules_due_idx
  on public.task_rules(active,next_run_at)
  where deleted_at is null and active;
create index if not exists task_instances_employee_due_idx
  on public.task_assignments(organization_id,employee_id,task_instance_id,status);
create index if not exists task_instances_clockout_idx
  on public.task_instances(organization_id,location_id,shift_id,status,blocking_clockout)
  where deleted_at is null;
create index if not exists task_evidence_instance_idx
  on public.task_evidence(organization_id,task_instance_id,template_item_id)
  where deleted_at is null;
create index if not exists notifications_employee_created_idx
  on public.notifications(organization_id,employee_id,created_at desc)
  where deleted_at is null;
create index if not exists notification_deliveries_retry_idx
  on public.notification_deliveries(status,next_attempt_at)
  where status in ('pending','failed');
create index if not exists idempotency_records_expiry_idx
  on public.idempotency_records(expires_at);

-- Atomic manager decision for open-shift claims.
create or replace function public.aora_decide_open_shift_atomic(
  p_token text,
  p_request_id text,
  p_decision text,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session record;
  v_request public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_scope text;
  v_existing jsonb;
  v_response jsonb;
begin
  if p_decision not in ('approved','rejected') then
    raise exception using errcode='22023', message='Ungültige Entscheidung.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='22023', message='Idempotency-Key fehlt.';
  end if;

  select * into v_session from public.validate_demo_session(p_token) limit 1;
  if v_session.organization_id is null then
    raise exception using errcode='28000', message='Sitzung ist ungültig oder abgelaufen.';
  end if;
  if v_session.role <> 'admin' then
    raise exception using errcode='42501', message='Nur Inhaber oder Manager dürfen Schichtanfragen entscheiden.';
  end if;

  select response into v_existing
  from public.idempotency_records
  where organization_id=v_session.organization_id
    and action='shift_request_decision'
    and actor_id=v_session.subject_id
    and idempotency_key=p_idempotency_key
    and status='completed';
  if found then return v_existing; end if;

  insert into public.idempotency_records(organization_id,action,actor_id,idempotency_key)
  values (v_session.organization_id,'shift_request_decision',v_session.subject_id,p_idempotency_key)
  on conflict do nothing;

  select * into v_request
  from public.shift_requests
  where organization_id=v_session.organization_id and id=p_request_id and deleted_at is null
  for update;
  if not found then raise exception using errcode='P0002', message='Schichtanfrage wurde nicht gefunden.'; end if;

  select * into v_shift
  from public.shifts
  where organization_id=v_session.organization_id and id=v_request.shift_id and deleted_at is null
  for update;
  if not found then raise exception using errcode='P0002', message='Schicht wurde nicht gefunden.'; end if;

  select coalesce(payload->>'scope','manager') into v_scope
  from public.admins
  where organization_id=v_session.organization_id and id=v_session.subject_id;
  if coalesce(v_scope,'manager') <> 'owner' and not exists (
    select 1 from public.manager_location_access
    where organization_id=v_session.organization_id
      and manager_id=v_session.subject_id
      and location_id=v_shift.location_id
  ) then
    raise exception using errcode='42501', message='Kein Zugriff auf diesen Standort.';
  end if;

  if v_request.status <> 'pending' then
    raise exception using errcode='40001', message='Diese Anfrage wurde bereits entschieden.';
  end if;

  if p_decision='approved' then
    if v_shift.status <> 'open' or v_shift.employee_id is not null then
      raise exception using errcode='40001', message='Die offene Schicht wurde bereits vergeben.';
    end if;
    update public.shifts
    set employee_id=v_request.employee_id,
        status='confirmed',
        version=version+1,
        reservation_version=reservation_version+1,
        updated_by=v_session.subject_id,
        updated_at=now()
    where organization_id=v_session.organization_id and id=v_shift.id;

    update public.shift_requests
    set status=case when id=v_request.id then 'approved' else 'filled' end,
        decided_at=now(),
        decided_by=v_session.subject_id,
        reason=case when id=v_request.id then coalesce(nullif(p_reason,''),reason) else reason end,
        updated_at=now()
    where organization_id=v_session.organization_id
      and shift_id=v_shift.id
      and status='pending';
  else
    update public.shift_requests
    set status='rejected', decided_at=now(), decided_by=v_session.subject_id,
        reason=coalesce(nullif(p_reason,''),reason), updated_at=now()
    where organization_id=v_session.organization_id and id=v_request.id;
  end if;

  insert into public.notifications(
    organization_id,id,employee_id,location_id,type,title,body,related_entity_type,related_entity_id,read,payload,idempotency_key,created_at
  ) values (
    v_session.organization_id,
    'note_'||replace(gen_random_uuid()::text,'-',''),
    v_request.employee_id,
    v_shift.location_id,
    'shift_request_decision',
    case when p_decision='approved' then 'Schicht bestätigt' else 'Schichtanfrage abgelehnt' end,
    case when p_decision='approved' then 'Deine Anfrage für die offene Schicht wurde bestätigt.' else coalesce(nullif(p_reason,''),'Deine Anfrage wurde abgelehnt.') end,
    'shift',v_shift.id,false,
    jsonb_build_object('requestId',v_request.id,'decision',p_decision),
    'shift-decision:'||v_request.id||':'||p_decision,
    now()
  ) on conflict do nothing;

  insert into public.audit_logs(
    organization_id,id,location_id,action,actor,actor_type,actor_id,entity,entity_type,entity_id,created_at,payload,metadata
  ) values (
    v_session.organization_id,
    'audit_'||replace(gen_random_uuid()::text,'-',''),
    v_shift.location_id,
    'SHIFT_REQUEST_'||upper(p_decision),
    v_session.subject_id,'admin',v_session.subject_id,
    'shift_request','shift_request',v_request.id,now(),
    jsonb_build_object('shiftId',v_shift.id,'employeeId',v_request.employee_id,'reason',p_reason),
    jsonb_build_object('idempotencyKey',p_idempotency_key)
  );

  v_response=jsonb_build_object(
    'requestId',v_request.id,
    'shiftId',v_shift.id,
    'employeeId',v_request.employee_id,
    'decision',p_decision,
    'serverTime',now()
  );
  update public.idempotency_records
  set status='completed', response=v_response, updated_at=now()
  where organization_id=v_session.organization_id
    and action='shift_request_decision'
    and actor_id=v_session.subject_id
    and idempotency_key=p_idempotency_key;
  return v_response;
exception when others then
  update public.idempotency_records
  set status='failed',error=sqlerrm,updated_at=now()
  where organization_id=coalesce(v_session.organization_id,'00000000-0000-0000-0000-000000000000'::uuid)
    and action='shift_request_decision'
    and actor_id=coalesce(v_session.subject_id,'unknown')
    and idempotency_key=p_idempotency_key;
  raise;
end $$;

create or replace function public.aora_clockout_gate(
  p_token text,
  p_employee_id text,
  p_location_id text,
  p_shift_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session record;
  v_count integer;
  v_tasks jsonb;
  v_scope text;
begin
  select * into v_session from public.validate_demo_session(p_token) limit 1;
  if v_session.organization_id is null then
    raise exception using errcode='28000', message='Sitzung ist ungültig oder abgelaufen.';
  end if;
  if v_session.role='employee' and v_session.subject_id<>p_employee_id then
    raise exception using errcode='42501', message='Kein Zugriff auf diesen Mitarbeiter.';
  end if;
  if v_session.role='kiosk' and v_session.location_id<>p_location_id then
    raise exception using errcode='42501', message='Kiosk gehört zu einem anderen Standort.';
  end if;
  if v_session.role='admin' then
    select coalesce(payload->>'scope','manager') into v_scope from public.admins
    where organization_id=v_session.organization_id and id=v_session.subject_id;
    if coalesce(v_scope,'manager')<>'owner' and not exists (
      select 1 from public.manager_location_access
      where organization_id=v_session.organization_id and manager_id=v_session.subject_id and location_id=p_location_id
    ) then raise exception using errcode='42501',message='Kein Zugriff auf diesen Standort.'; end if;
  end if;

  select count(*),coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'title',t.title,'status',i.status,'dueAt',i.due_at,'policy',coalesce(r.clockout_policy,t.clockout_policy)
  ) order by i.due_at nulls last),'[]'::jsonb)
  into v_count,v_tasks
  from public.task_instances i
  join public.task_assignments a on a.organization_id=i.organization_id and a.task_instance_id=i.id
  join public.task_templates t on t.organization_id=i.organization_id and t.id=i.template_id
  left join public.task_rules r on r.organization_id=i.organization_id and r.id=i.rule_id
  where i.organization_id=v_session.organization_id
    and i.location_id=p_location_id
    and a.employee_id=p_employee_id
    and i.deleted_at is null
    and i.status not in ('completed','waived','cancelled')
    and i.blocking_clockout
    and (p_shift_id is null or i.shift_id=p_shift_id);

  return jsonb_build_object('allowed',v_count=0,'blockingCount',v_count,'tasks',v_tasks,'serverTime',now());
end $$;

create or replace function public.aora_verify_canonical_backfill(p_organization_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'organizationId',p_organization_id,
    'locations',(select count(*) from public.locations where organization_id=p_organization_id and deleted_at is null),
    'employees',(select count(*) from public.employees where organization_id=p_organization_id and deleted_at is null),
    'shifts',(select count(*) from public.shifts where organization_id=p_organization_id and deleted_at is null),
    'timeEntries',(select count(*) from public.time_entries where organization_id=p_organization_id and deleted_at is null),
    'shiftRequests',(select count(*) from public.shift_requests where organization_id=p_organization_id and deleted_at is null),
    'taskTemplates',(select count(*) from public.task_templates where organization_id=p_organization_id and deleted_at is null),
    'taskInstances',(select count(*) from public.task_instances where organization_id=p_organization_id and deleted_at is null),
    'notifications',(select count(*) from public.notifications where organization_id=p_organization_id and deleted_at is null),
    'durationMinutes',(select coalesce(sum(duration_minutes),0) from public.time_entries where organization_id=p_organization_id and deleted_at is null),
    'activeEmployees',(select count(*) from public.employees where organization_id=p_organization_id and active and deleted_at is null),
    'openShifts',(select count(*) from public.shifts where organization_id=p_organization_id and status='open' and employee_id is null and deleted_at is null),
    'verifiedAt',now()
  );
$$;

revoke all on function public.aora_decide_open_shift_atomic(text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.aora_clockout_gate(text,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_verify_canonical_backfill(uuid) from public,anon,authenticated;
grant execute on function public.aora_decide_open_shift_atomic(text,text,text,text,uuid) to service_role;
grant execute on function public.aora_clockout_gate(text,text,text,text) to service_role;
grant execute on function public.aora_verify_canonical_backfill(uuid) to service_role;

-- Edge-only tables: RLS is defense in depth; app-session authorization happens in Edge Functions/RPCs.
alter table public.task_rules enable row level security;
alter table public.task_generation_keys enable row level security;
alter table public.task_evidence enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.feature_flag_rules enable row level security;
alter table public.scheduler_runs enable row level security;
alter table public.idempotency_records enable row level security;

revoke all on public.task_rules,public.task_generation_keys,public.task_evidence,
  public.notification_deliveries,public.feature_flag_rules,public.scheduler_runs,public.idempotency_records
from anon,authenticated;
grant all on public.task_rules,public.task_generation_keys,public.task_evidence,
  public.notification_deliveries,public.feature_flag_rules,public.scheduler_runs,public.idempotency_records
to service_role;

-- Explicit deny policies for any RLS table that has no policy. Service role bypasses RLS.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid=c.oid)
  loop
    execute format('create policy "edge_only_deny_direct" on %s for all to anon, authenticated using (false) with check (false)',r.table_name);
  end loop;
end $$;

-- Keep task evidence private and service-mediated.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('checklist-evidence','checklist-evidence',false,15728640,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

commit;
