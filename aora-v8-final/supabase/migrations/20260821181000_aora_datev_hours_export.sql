begin;

create table if not exists public.datev_hours_export_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  target_system text not null default 'datev_lodas' check (target_system = 'datev_lodas'),
  berater_number text not null check (berater_number ~ '^\d{4,7}$'),
  mandant_number text not null check (mandant_number ~ '^\d{1,5}$'),
  regular_wage_type text not null check (regular_wage_type ~ '^\d{1,4}$'),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.datev_hours_employee_mappings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  personnel_number text not null check (personnel_number ~ '^\d{1,9}$'),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, employee_id),
  unique (organization_id, personnel_number)
);

create table if not exists public.datev_hours_export_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  target_system text not null default 'datev_lodas' check (target_system = 'datev_lodas'),
  row_count integer not null check (row_count >= 0),
  total_minutes integer not null check (total_minutes >= 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists datev_hours_export_runs_org_created_idx
  on public.datev_hours_export_runs (organization_id, created_at desc);

alter table public.datev_hours_export_settings enable row level security;
alter table public.datev_hours_employee_mappings enable row level security;
alter table public.datev_hours_export_runs enable row level security;

revoke all on table public.datev_hours_export_settings from anon, authenticated;
revoke all on table public.datev_hours_employee_mappings from anon, authenticated;
revoke all on table public.datev_hours_export_runs from anon, authenticated;

commit;
