begin;

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id text,
  flag_key text not null check (flag_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, location_id, flag_key),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade
);

create table if not exists public.employee_location_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  location_id text not null,
  access_level text not null default 'member' check (access_level in ('member','lead')),
  created_at timestamptz not null default now(),
  created_by text,
  primary key (organization_id, employee_id, location_id),
  foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade
);

create table if not exists public.shift_series (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id text not null,
  location_id text not null,
  employee_id text,
  starts_on date not null,
  ends_on date not null,
  recurrence text not null check (recurrence in ('daily','weekly','biweekly','rotation')),
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  template jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete set null,
  check (ends_on >= starts_on)
);

alter table public.shifts
  add column if not exists series_id text,
  add column if not exists reservation_version integer not null default 0;

create index if not exists shifts_series_idx
  on public.shifts(organization_id, series_id, shift_date)
  where series_id is not null;

create index if not exists shifts_open_location_date_idx
  on public.shifts(organization_id, location_id, shift_date)
  where status = 'open' and employee_id is null;

create table if not exists public.shift_reservations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  shift_id text not null,
  employee_id text not null,
  location_id text not null,
  idempotency_key uuid not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  reserved_at timestamptz not null default now(),
  cancelled_at timestamptz,
  receipt jsonb not null default '{}'::jsonb,
  primary key (organization_id, id),
  unique (organization_id, shift_id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, shift_id)
    references public.shifts(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade
);

create table if not exists public.task_templates (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id text not null,
  location_id text,
  title text not null,
  description text,
  recurrence text not null default 'manual'
    check (recurrence in ('manual','daily','weekly','shift_start','shift_end')),
  block_clock_out boolean not null default false,
  active boolean not null default true,
  source_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade
);

create table if not exists public.task_template_items (
  organization_id uuid not null,
  template_id text not null,
  id text not null,
  position integer not null default 0,
  label text not null,
  answer_type text not null
    check (answer_type in ('checkbox','text','number','photo','select')),
  required boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  primary key (organization_id, template_id, id),
  foreign key (organization_id, template_id)
    references public.task_templates(organization_id, id) on delete cascade
);

create table if not exists public.task_instances (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id text not null,
  template_id text not null,
  location_id text not null,
  shift_id text,
  instance_date date not null,
  due_at timestamptz,
  status text not null default 'open'
    check (status in ('open','in_progress','completed','waived','cancelled')),
  version integer not null default 1 check (version > 0),
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, template_id)
    references public.task_templates(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, shift_id)
    references public.shifts(organization_id, id) on delete set null
);

create table if not exists public.task_assignments (
  organization_id uuid not null,
  task_instance_id text not null,
  employee_id text not null,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (organization_id, task_instance_id, employee_id),
  foreign key (organization_id, task_instance_id)
    references public.task_instances(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade
);

create table if not exists public.task_answers (
  organization_id uuid not null,
  task_instance_id text not null,
  template_item_id text not null,
  employee_id text not null,
  value jsonb not null,
  evidence_path text,
  answered_at timestamptz not null default now(),
  primary key (organization_id, task_instance_id, template_item_id),
  foreign key (organization_id, task_instance_id, employee_id)
    references public.task_assignments(organization_id, task_instance_id, employee_id)
    on delete cascade
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  endpoint text not null,
  endpoint_hash bytea not null,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (organization_id, endpoint_hash),
  foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade
);

create table if not exists public.relational_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null unique,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','verified','failed')),
  verification jsonb not null default '{}'::jsonb
);

create index if not exists employee_location_access_location_idx
  on public.employee_location_access(organization_id, location_id, employee_id);
create index if not exists shift_series_location_dates_idx
  on public.shift_series(organization_id, location_id, starts_on, ends_on);
create index if not exists task_instances_location_date_idx
  on public.task_instances(organization_id, location_id, instance_date, status);
create index if not exists task_assignments_employee_idx
  on public.task_assignments(organization_id, employee_id, task_instance_id);
create index if not exists push_subscriptions_employee_idx
  on public.push_subscriptions(organization_id, employee_id)
  where active;

alter table public.feature_flags enable row level security;
alter table public.employee_location_access enable row level security;
alter table public.shift_series enable row level security;
alter table public.shift_reservations enable row level security;
alter table public.task_templates enable row level security;
alter table public.task_template_items enable row level security;
alter table public.task_instances enable row level security;
alter table public.task_assignments enable row level security;
alter table public.task_answers enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.relational_backfill_runs enable row level security;

revoke all on
  public.feature_flags,
  public.employee_location_access,
  public.shift_series,
  public.shift_reservations,
  public.task_templates,
  public.task_template_items,
  public.task_instances,
  public.task_assignments,
  public.task_answers,
  public.push_subscriptions,
  public.relational_backfill_runs
from anon, authenticated;

grant select on
  public.feature_flags,
  public.employee_location_access,
  public.shift_series,
  public.shift_reservations,
  public.task_templates,
  public.task_template_items,
  public.task_instances,
  public.task_assignments,
  public.task_answers
to authenticated;

grant all on
  public.feature_flags,
  public.employee_location_access,
  public.shift_series,
  public.shift_reservations,
  public.task_templates,
  public.task_template_items,
  public.task_instances,
  public.task_assignments,
  public.task_answers,
  public.push_subscriptions,
  public.relational_backfill_runs
to service_role;

drop policy if exists "members read feature flags" on public.feature_flags;
create policy "members read feature flags"
on public.feature_flags for select to authenticated
using (
  (select private.is_org_member(organization_id))
  and (
    location_id is null
    or (select private.manager_can_access_location(organization_id, location_id))
    or exists (
      select 1 from public.employee_location_access ela
      where ela.organization_id=feature_flags.organization_id
        and ela.location_id=feature_flags.location_id
        and ela.employee_id=(select private.current_employee_id(feature_flags.organization_id))
    )
  )
);

drop policy if exists "members read employee location access" on public.employee_location_access;
create policy "members read employee location access"
on public.employee_location_access for select to authenticated
using (
  (select private.is_org_admin(organization_id))
  or (select private.manager_can_access_location(organization_id, location_id))
  or employee_id=(select private.current_employee_id(organization_id))
);

drop policy if exists "members read shift series" on public.shift_series;
create policy "members read shift series"
on public.shift_series for select to authenticated
using (
  (select private.is_org_admin(organization_id))
  or (select private.manager_can_access_location(organization_id, location_id))
  or employee_id=(select private.current_employee_id(organization_id))
  or (
    employee_id is null
    and exists (
      select 1 from public.employee_location_access ela
      where ela.organization_id=shift_series.organization_id
        and ela.location_id=shift_series.location_id
        and ela.employee_id=(select private.current_employee_id(shift_series.organization_id))
    )
  )
);

drop policy if exists "members read shift reservations" on public.shift_reservations;
create policy "members read shift reservations"
on public.shift_reservations for select to authenticated
using (
  (select private.is_org_admin(organization_id))
  or (select private.manager_can_access_location(organization_id, location_id))
  or employee_id=(select private.current_employee_id(organization_id))
);

drop policy if exists "members read task templates" on public.task_templates;
create policy "members read task templates"
on public.task_templates for select to authenticated
using (
  (select private.is_org_admin(organization_id))
  or location_id is null
  or (select private.manager_can_access_location(organization_id, location_id))
  or exists (
    select 1 from public.employee_location_access ela
    where ela.organization_id=task_templates.organization_id
      and ela.location_id=task_templates.location_id
      and ela.employee_id=(select private.current_employee_id(task_templates.organization_id))
  )
);

drop policy if exists "members read task template items" on public.task_template_items;
create policy "members read task template items"
on public.task_template_items for select to authenticated
using (
  exists (
    select 1 from public.task_templates template
    where template.organization_id=task_template_items.organization_id
      and template.id=task_template_items.template_id
  )
);

drop policy if exists "members read task instances" on public.task_instances;
create policy "members read task instances"
on public.task_instances for select to authenticated
using (
  (select private.is_org_admin(organization_id))
  or (select private.manager_can_access_location(organization_id, location_id))
  or exists (
    select 1 from public.task_assignments assignment
    where assignment.organization_id=task_instances.organization_id
      and assignment.task_instance_id=task_instances.id
      and assignment.employee_id=(select private.current_employee_id(task_instances.organization_id))
  )
);

drop policy if exists "members read task assignments" on public.task_assignments;
create policy "members read task assignments"
on public.task_assignments for select to authenticated
using (
  (select private.is_org_admin(organization_id))
  or employee_id=(select private.current_employee_id(organization_id))
  or exists (
    select 1 from public.task_instances instance
    where instance.organization_id=task_assignments.organization_id
      and instance.id=task_assignments.task_instance_id
      and (select private.manager_can_access_location(instance.organization_id, instance.location_id))
  )
);

drop policy if exists "members read task answers" on public.task_answers;
create policy "members read task answers"
on public.task_answers for select to authenticated
using (
  (select private.is_org_admin(organization_id))
  or employee_id=(select private.current_employee_id(organization_id))
  or exists (
    select 1 from public.task_instances instance
    where instance.organization_id=task_answers.organization_id
      and instance.id=task_answers.task_instance_id
      and (select private.manager_can_access_location(instance.organization_id, instance.location_id))
  )
);

insert into public.relational_backfill_runs(migration_key)
values ('202607292000_aora_relational_workforce_foundation')
on conflict (migration_key) do update
set started_at=excluded.started_at, completed_at=null, status='running', verification='{}'::jsonb;

insert into public.employee_location_access(organization_id, employee_id, location_id, created_by)
select organization_id, id, location_id, 'legacy-primary-location'
from public.employees
where location_id is not null
on conflict (organization_id, employee_id, location_id) do nothing;

insert into public.feature_flags(organization_id, flag_key, enabled)
select organization.id, flag.flag_key, false
from public.organizations organization
cross join (
  values
    ('relational_read_v1'),
    ('relational_dual_write_v1'),
    ('calendar_v2'),
    ('weekly_schedule_v2'),
    ('open_shift_reservation'),
    ('task_automation'),
    ('clock_out_task_gate'),
    ('web_push'),
    ('legacy_endpoint_block')
) as flag(flag_key)
on conflict (organization_id, location_id, flag_key) do nothing;

insert into public.task_templates(
  organization_id,id,location_id,title,description,recurrence,block_clock_out,
  active,source_version,payload,created_at,updated_at
)
select
  organization_id,
  id,
  location_id,
  title,
  nullif(payload->>'description',''),
  case
    when payload->>'recurrence' in ('daily','weekly','shift_start','shift_end')
      then payload->>'recurrence'
    else 'manual'
  end,
  coalesce((payload->>'blockClockOut')::boolean,false),
  active,
  greatest(version,1),
  payload,
  coalesce((payload->>'createdAt')::timestamptz,now()),
  coalesce((payload->>'updatedAt')::timestamptz,now())
from public.checklist_templates
on conflict (organization_id,id) do update
set
  location_id=excluded.location_id,
  title=excluded.title,
  description=excluded.description,
  recurrence=excluded.recurrence,
  block_clock_out=excluded.block_clock_out,
  active=excluded.active,
  source_version=excluded.source_version,
  payload=excluded.payload,
  updated_at=excluded.updated_at;

insert into public.task_template_items(
  organization_id,template_id,id,position,label,answer_type,required,config
)
select
  template.organization_id,
  template.id,
  item.value->>'id',
  item.ordinality-1,
  coalesce(item.value->>'label',item.value->>'id'),
  case
    when item.value->>'type' in ('checkbox','text','number','photo','select')
      then item.value->>'type'
    else 'text'
  end,
  coalesce((item.value->>'required')::boolean,false),
  item.value - 'id' - 'label' - 'type' - 'required'
from public.checklist_templates template
cross join lateral jsonb_array_elements(coalesce(template.payload->'items','[]'::jsonb))
  with ordinality as item(value, ordinality)
where nullif(item.value->>'id','') is not null
on conflict (organization_id,template_id,id) do update
set
  position=excluded.position,
  label=excluded.label,
  answer_type=excluded.answer_type,
  required=excluded.required,
  config=excluded.config;

insert into public.task_instances(
  organization_id,id,template_id,location_id,instance_date,due_at,status,version,
  completed_at,payload,created_at,updated_at
)
select
  assignment.organization_id,
  assignment.id,
  assignment.template_id,
  assignment.location_id,
  assignment.assignment_date,
  case
    when assignment.payload->>'dueTime' ~ '^\d{2}:\d{2}$'
      then (assignment.assignment_date::text||'T'||(assignment.payload->>'dueTime')||':00+00')::timestamptz
    else null
  end,
  case
    when assignment.status in ('complete','completed') then 'completed'
    when assignment.status in ('open','in_progress','waived','cancelled') then assignment.status
    else 'open'
  end,
  greatest(assignment.version,1),
  nullif(assignment.payload->>'completedAt','')::timestamptz,
  assignment.payload,
  coalesce(nullif(assignment.payload->>'createdAt','')::timestamptz,now()),
  coalesce(nullif(assignment.payload->>'updatedAt','')::timestamptz,now())
from public.checklist_assignments assignment
join public.task_templates template
  on template.organization_id=assignment.organization_id
 and template.id=assignment.template_id
on conflict (organization_id,id) do update
set
  status=excluded.status,
  version=excluded.version,
  completed_at=excluded.completed_at,
  payload=excluded.payload,
  updated_at=excluded.updated_at;

insert into public.task_assignments(
  organization_id,task_instance_id,employee_id,assigned_at,completed_at
)
select
  assignment.organization_id,
  assignment.id,
  assignment.employee_id,
  coalesce(nullif(assignment.payload->>'createdAt','')::timestamptz,now()),
  nullif(assignment.payload->>'completedAt','')::timestamptz
from public.checklist_assignments assignment
join public.task_instances instance
  on instance.organization_id=assignment.organization_id and instance.id=assignment.id
join public.employees employee
  on employee.organization_id=assignment.organization_id and employee.id=assignment.employee_id
on conflict (organization_id,task_instance_id,employee_id) do update
set completed_at=excluded.completed_at;

insert into public.task_answers(
  organization_id,task_instance_id,template_item_id,employee_id,value,evidence_path,answered_at
)
select
  assignment.organization_id,
  assignment.id,
  answer.key,
  assignment.employee_id,
  answer.value,
  case when jsonb_typeof(answer.value)='object' then answer.value->>'evidencePath' end,
  coalesce(nullif(assignment.payload->>'updatedAt','')::timestamptz,now())
from public.checklist_assignments assignment
cross join lateral jsonb_each(coalesce(assignment.payload->'answers','{}'::jsonb)) answer
join public.task_assignments task_assignment
  on task_assignment.organization_id=assignment.organization_id
 and task_assignment.task_instance_id=assignment.id
 and task_assignment.employee_id=assignment.employee_id
join public.task_template_items item
  on item.organization_id=assignment.organization_id
 and item.template_id=assignment.template_id
 and item.id=answer.key
on conflict (organization_id,task_instance_id,template_item_id) do update
set
  value=excluded.value,
  evidence_path=excluded.evidence_path,
  answered_at=excluded.answered_at;

create or replace function public.aora_reserve_open_shift_atomic(
  p_organization_id uuid,
  p_shift_id text,
  p_employee_id text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  existing_receipt jsonb;
  reserved_shift public.shifts%rowtype;
  employee_location text;
  result jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text||':'||p_idempotency_key::text,0)
  );
  select receipt into existing_receipt
  from public.shift_reservations
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if existing_receipt is not null then return existing_receipt; end if;

  select location_id into employee_location
  from public.employees
  where organization_id=p_organization_id and id=p_employee_id and active=true;
  if not found then raise exception 'EMPLOYEE_NOT_ACTIVE'; end if;

  update public.shifts
  set
    employee_id=p_employee_id,
    status='published',
    reservation_version=reservation_version+1,
    payload=jsonb_set(
      jsonb_set(payload,'{employeeId}',to_jsonb(p_employee_id),true),
      '{status}','"published"'::jsonb,true
    )
  where organization_id=p_organization_id
    and id=p_shift_id
    and employee_id is null
    and status='open'
    and (
      location_id=employee_location
      or exists (
        select 1 from public.employee_location_access access
        where access.organization_id=p_organization_id
          and access.employee_id=p_employee_id
          and access.location_id=shifts.location_id
      )
    )
  returning * into reserved_shift;

  if not found then raise exception 'OPEN_SHIFT_NOT_AVAILABLE'; end if;

  result=jsonb_build_object(
    'reservationId',gen_random_uuid(),
    'shiftId',reserved_shift.id,
    'employeeId',reserved_shift.employee_id,
    'locationId',reserved_shift.location_id,
    'status','confirmed',
    'reservationVersion',reserved_shift.reservation_version
  );

  insert into public.shift_reservations(
    organization_id,id,shift_id,employee_id,location_id,idempotency_key,receipt
  )
  values (
    p_organization_id,(result->>'reservationId')::uuid,reserved_shift.id,p_employee_id,
    reserved_shift.location_id,p_idempotency_key,result
  );
  return result;
end
$$;

revoke all on function public.aora_reserve_open_shift_atomic(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.aora_reserve_open_shift_atomic(uuid,text,text,uuid) to service_role;

create or replace function public.aora_verify_relational_backfill()
returns jsonb
language sql
security invoker
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'employeePrimaryLocationsMissing',(
      select count(*) from public.employees employee
      where employee.location_id is not null and not exists (
        select 1 from public.employee_location_access access
        where access.organization_id=employee.organization_id
          and access.employee_id=employee.id and access.location_id=employee.location_id
      )
    ),
    'taskTemplatesLegacy',(select count(*) from public.checklist_templates),
    'taskTemplatesCanonical',(select count(*) from public.task_templates),
    'taskAssignmentsLegacy',(select count(*) from public.checklist_assignments),
    'taskInstancesCanonical',(select count(*) from public.task_instances),
    'organizationsWithoutFlags',(
      select count(*) from public.organizations organization
      where not exists (
        select 1 from public.feature_flags flag where flag.organization_id=organization.id
      )
    )
  )
$$;

revoke all on function public.aora_verify_relational_backfill() from public, anon, authenticated;
grant execute on function public.aora_verify_relational_backfill() to service_role;

update public.relational_backfill_runs
set
  completed_at=now(),
  status='verified',
  verification=public.aora_verify_relational_backfill()
where migration_key='202607292000_aora_relational_workforce_foundation';

commit;
