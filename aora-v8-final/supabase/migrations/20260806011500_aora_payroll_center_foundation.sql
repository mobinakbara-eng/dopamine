-- Aora payroll preparation foundation.
-- Additive only: no existing employee, time-entry, submission, or workspace rows are deleted.

alter table public.timesheet_submissions
  add column if not exists approval_method text,
  add column if not exists acknowledgement_hash text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheet_submissions_approval_method_check'
      and conrelid = 'public.timesheet_submissions'::regclass
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_approval_method_check
      check (approval_method is null or approval_method in ('signature','acknowledgement'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheet_submissions_acknowledgement_hash_check'
      and conrelid = 'public.timesheet_submissions'::regclass
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_acknowledgement_hash_check
      check (acknowledgement_hash is null or acknowledgement_hash ~ '^[a-f0-9]{64}$');
  end if;
end $$;

comment on column public.timesheet_submissions.approval_method is
  'How the employee approved this exact version: optional document signature or acknowledgement without signature.';

create table if not exists public.payroll_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  payroll_system text not null default 'generic_excel'
    check (payroll_system in ('generic_excel','datev_lodas','datev_lohn_gehalt','other')),
  consultant_name text,
  consultant_email text,
  holiday_region text,
  cutoff_day smallint not null default 1 check (cutoff_day between 1 and 31),
  settings jsonb not null default '{}'::jsonb,
  mapping_version integer not null default 1 check (mapping_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_payroll_identities (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  personnel_number text not null,
  cost_center text,
  department_code text,
  payroll_group text,
  valid_from date not null default current_date,
  valid_to date,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, employee_id),
  foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade,
  check (length(btrim(personnel_number)) between 1 and 64),
  check (valid_to is null or valid_to >= valid_from)
);

create unique index if not exists employee_payroll_identity_personnel_uq
  on public.employee_payroll_identities (organization_id, lower(personnel_number));

create table if not exists public.employment_schedules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  valid_from date not null default current_date,
  valid_to date,
  monday_minutes integer not null default 0 check (monday_minutes between 0 and 1440),
  tuesday_minutes integer not null default 0 check (tuesday_minutes between 0 and 1440),
  wednesday_minutes integer not null default 0 check (wednesday_minutes between 0 and 1440),
  thursday_minutes integer not null default 0 check (thursday_minutes between 0 and 1440),
  friday_minutes integer not null default 0 check (friday_minutes between 0 and 1440),
  saturday_minutes integer not null default 0 check (saturday_minutes between 0 and 1440),
  sunday_minutes integer not null default 0 check (sunday_minutes between 0 and 1440),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, employee_id, valid_from),
  foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade,
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists employment_schedules_lookup_idx
  on public.employment_schedules (organization_id, employee_id, valid_from desc);

create table if not exists public.wage_type_mappings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_system text not null,
  source_type text not null
    check (source_type in ('regular','overtime','night','sunday','holiday','vacation','sickness','correction')),
  external_wage_type text,
  label text not null,
  unit text not null default 'hours' check (unit in ('hours','days','amount')),
  rounding_rule text not null default 'minute' check (rounding_rule in ('minute','quarter_hour','hundredth_hour')),
  valid_from date not null default current_date,
  valid_to date,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, payroll_system, source_type, valid_from),
  check (valid_to is null or valid_to >= valid_from)
);

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  year integer not null check (year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  version integer not null check (version > 0),
  status text not null default 'closed' check (status in ('closed','reopened','exported')),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null,
  closed_by text not null,
  closed_at timestamptz not null default clock_timestamp(),
  reopened_by text,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, year, month, version)
);

create index if not exists payroll_periods_latest_idx
  on public.payroll_periods (organization_id, year, month, version desc);

create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id text not null,
  work_date date,
  source_entry_id text,
  line_type text not null,
  minutes integer not null default 0,
  days numeric(10,4) not null default 0,
  amount numeric(14,2),
  external_wage_type text,
  cost_center text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete restrict
);

create index if not exists payroll_lines_period_employee_idx
  on public.payroll_lines (payroll_period_id, employee_id, work_date);

create table if not exists public.payroll_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id text,
  code text not null,
  severity text not null check (severity in ('blocker','warning','info')),
  message text not null,
  source_entity_type text,
  source_entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists payroll_exceptions_period_idx
  on public.payroll_exceptions (payroll_period_id, severity, employee_id);

create table if not exists public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods(id) on delete restrict,
  format text not null default 'zip' check (format in ('zip','xlsx','csv','pdf')),
  status text not null default 'ready' check (status in ('processing','ready','failed')),
  schema_version text not null default 'aora-payroll-export/1.0',
  storage_path text not null unique,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  row_count integer not null default 0 check (row_count >= 0),
  created_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists payroll_exports_period_idx
  on public.payroll_exports (payroll_period_id, created_at desc);

create table if not exists public.payroll_export_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_id uuid not null references public.payroll_exports(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists payroll_export_files_export_idx
  on public.payroll_export_files (export_id);

alter table public.payroll_profiles enable row level security;
alter table public.employee_payroll_identities enable row level security;
alter table public.employment_schedules enable row level security;
alter table public.wage_type_mappings enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.payroll_exceptions enable row level security;
alter table public.payroll_exports enable row level security;
alter table public.payroll_export_files enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'payroll_profiles','employee_payroll_identities','employment_schedules',
    'wage_type_mappings','payroll_periods','payroll_lines','payroll_exceptions',
    'payroll_exports','payroll_export_files'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = 'edge_only_deny_direct'
    ) then
      execute format(
        'create policy edge_only_deny_direct on public.%I for all to anon, authenticated using (false) with check (false)',
        table_name
      );
    end if;
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payroll-exports',
  'payroll-exports',
  false,
  52428800,
  array['application/zip','application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.aora_close_payroll_period_atomic(
  p_organization_id uuid,
  p_year integer,
  p_month integer,
  p_actor_id text,
  p_snapshot_hash text,
  p_snapshot jsonb,
  p_lines jsonb,
  p_exceptions jsonb
)
returns table(period_id uuid, period_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_id uuid := gen_random_uuid();
  v_version integer;
  v_line jsonb;
  v_exception jsonb;
begin
  if p_year < 2000 or p_year > 2200 or p_month < 1 or p_month > 12 then
    raise exception 'invalid payroll period';
  end if;
  if p_snapshot_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid snapshot hash';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || p_year::text || ':' || p_month::text));

  select coalesce(max(version), 0) + 1
    into v_version
    from public.payroll_periods
   where organization_id = p_organization_id
     and year = p_year
     and month = p_month;

  insert into public.payroll_periods (
    id, organization_id, year, month, version, status,
    snapshot_hash, snapshot, closed_by, closed_at
  ) values (
    v_period_id, p_organization_id, p_year, p_month, v_version, 'closed',
    p_snapshot_hash, p_snapshot, p_actor_id, clock_timestamp()
  );

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.payroll_lines (
      organization_id, payroll_period_id, employee_id, work_date,
      source_entry_id, line_type, minutes, days, amount,
      external_wage_type, cost_center, payload
    ) values (
      p_organization_id,
      v_period_id,
      v_line->>'employeeId',
      nullif(v_line->>'workDate','')::date,
      nullif(v_line->>'sourceEntryId',''),
      v_line->>'lineType',
      coalesce((v_line->>'minutes')::integer, 0),
      coalesce((v_line->>'days')::numeric, 0),
      nullif(v_line->>'amount','')::numeric,
      nullif(v_line->>'externalWageType',''),
      nullif(v_line->>'costCenter',''),
      coalesce(v_line->'payload', '{}'::jsonb)
    );
  end loop;

  for v_exception in select value from jsonb_array_elements(coalesce(p_exceptions, '[]'::jsonb))
  loop
    insert into public.payroll_exceptions (
      organization_id, payroll_period_id, employee_id, code, severity,
      message, source_entity_type, source_entity_id, payload
    ) values (
      p_organization_id,
      v_period_id,
      nullif(v_exception->>'employeeId',''),
      v_exception->>'code',
      v_exception->>'severity',
      v_exception->>'message',
      nullif(v_exception->>'sourceEntityType',''),
      nullif(v_exception->>'sourceEntityId',''),
      coalesce(v_exception->'payload', '{}'::jsonb)
    );
  end loop;

  insert into public.audit_logs (
    organization_id, id, action, actor, actor_type, actor_id,
    entity, entity_type, entity_id, created_at, payload, metadata
  ) values (
    p_organization_id,
    gen_random_uuid()::text,
    'PAYROLL_PERIOD_CLOSED',
    p_actor_id,
    'manager',
    p_actor_id,
    'payroll_period',
    'payroll_period',
    v_period_id::text,
    clock_timestamp(),
    jsonb_build_object('year', p_year, 'month', p_month, 'version', v_version, 'snapshotHash', p_snapshot_hash),
    jsonb_build_object('source', 'aora-v8-payroll-center')
  );

  return query select v_period_id, v_version;
end;
$$;

revoke all on function public.aora_close_payroll_period_atomic(uuid,integer,integer,text,text,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.aora_close_payroll_period_atomic(uuid,integer,integer,text,text,jsonb,jsonb,jsonb)
  to service_role;