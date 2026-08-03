-- Additive workflow for employee consents, reusable signatures and approved timesheet exports.
-- The application accesses these tables only through a service-role Edge Function.

create table if not exists public.employee_consent_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  location_id text,
  requested_by text not null,
  document_version text not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  cancelled_at timestamptz,
  constraint employee_consent_requests_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade,
  constraint employee_consent_requests_location_fk
    foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete restrict
);

create table if not exists public.employee_document_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.employee_consent_requests(id) on delete cascade,
  employee_id text not null,
  consent_key text not null,
  statement_type text not null check (statement_type in ('consent','acknowledgement','authorization')),
  statement_version text not null,
  statement_hash text not null,
  accepted boolean not null,
  accepted_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint employee_document_consents_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade,
  constraint employee_document_consents_request_unique unique (request_id, consent_key)
);

create table if not exists public.employee_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  consent_request_id uuid not null references public.employee_consent_requests(id) on delete restrict,
  storage_path text not null unique,
  mime_type text not null default 'image/png' check (mime_type = 'image/png'),
  sha256 text not null,
  byte_size integer not null check (byte_size between 1 and 1048576),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint employee_signatures_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade
);

alter table public.timesheet_submissions
  add column if not exists location_id text,
  add column if not exists date_from date,
  add column if not exists date_to date,
  add column if not exists sent_by text,
  add column if not exists sent_at timestamptz,
  add column if not exists employee_decision text check (employee_decision is null or employee_decision in ('approved','declined')),
  add column if not exists employee_decided_at timestamptz,
  add column if not exists employee_note text,
  add column if not exists signature_id uuid references public.employee_signatures(id) on delete restrict,
  add column if not exists snapshot_hash text,
  add column if not exists signed_hash text,
  add column if not exists exported_at timestamptz,
  add column if not exists exported_by text,
  add column if not exists export_format text,
  add column if not exists export_checksum text;

alter table public.timesheet_submissions
  drop constraint if exists timesheet_submissions_date_range_check;
alter table public.timesheet_submissions
  add constraint timesheet_submissions_date_range_check
  check (date_from is null or date_to is null or date_from <= date_to);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheet_submissions_employee_fk'
      and conrelid = 'public.timesheet_submissions'::regclass
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_employee_fk
      foreign key (organization_id, employee_id)
      references public.employees(organization_id, id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'timesheet_submissions_location_fk'
      and conrelid = 'public.timesheet_submissions'::regclass
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_location_fk
      foreign key (organization_id, location_id)
      references public.locations(organization_id, id) on delete restrict;
  end if;
end $$;

create index if not exists employee_consent_requests_employee_status_idx
  on public.employee_consent_requests (organization_id, employee_id, status, requested_at desc);
create index if not exists employee_document_consents_active_idx
  on public.employee_document_consents (organization_id, employee_id, consent_key, accepted_at desc)
  where accepted and revoked_at is null;
create unique index if not exists employee_signatures_one_active_idx
  on public.employee_signatures (organization_id, employee_id)
  where active and revoked_at is null;
create index if not exists timesheet_submissions_workflow_idx
  on public.timesheet_submissions (organization_id, location_id, status, sent_at desc);

alter table public.employee_consent_requests enable row level security;
alter table public.employee_document_consents enable row level security;
alter table public.employee_signatures enable row level security;

revoke all on public.employee_consent_requests from anon, authenticated;
revoke all on public.employee_document_consents from anon, authenticated;
revoke all on public.employee_signatures from anon, authenticated;
revoke all on public.timesheet_submissions from anon, authenticated;
grant all on public.employee_consent_requests to service_role;
grant all on public.employee_document_consents to service_role;
grant all on public.employee_signatures to service_role;
grant all on public.timesheet_submissions to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-signatures', 'employee-signatures', false, 1048576, array['image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.employee_consent_requests is 'Versioned manager-to-employee requests for signature and timesheet workflow permissions.';
comment on table public.employee_document_consents is 'Immutable acceptance records. Revocation is recorded without deleting prior evidence.';
comment on table public.employee_signatures is 'Private reusable signature images; never publicly addressable.';
comment on column public.timesheet_submissions.snapshot_hash is 'SHA-256 of the canonical timesheet snapshot presented to the employee.';
comment on column public.timesheet_submissions.signed_hash is 'SHA-256 binding snapshot hash, signature hash, employee identity and approval timestamp.';
