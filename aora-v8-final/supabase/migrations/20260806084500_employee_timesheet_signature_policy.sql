-- Additive per-employee signature policy. Existing data remains unchanged.
create table if not exists public.employee_timesheet_signature_policies (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  signature_required boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (organization_id, employee_id)
);

alter table public.employee_timesheet_signature_policies enable row level security;

alter table public.timesheet_submissions
  add column if not exists signature_required boolean not null default false;

create index if not exists idx_timesheet_signature_policy_org
  on public.employee_timesheet_signature_policies (organization_id, employee_id);

comment on table public.employee_timesheet_signature_policies is
  'Manager-selected per-employee policy used only when a new timesheet approval is requested.';
comment on column public.timesheet_submissions.signature_required is
  'Immutable requirement captured when this specific approval request was sent.';
