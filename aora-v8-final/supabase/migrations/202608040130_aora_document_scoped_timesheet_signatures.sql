-- Document-scoped employee signatures for immutable Arbeitszeitnachweis approvals.
-- A signature is captured for one exact snapshot/version and is never reused automatically.

create table if not exists public.timesheet_document_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id text not null,
  submission_version integer not null check (submission_version > 0),
  employee_id text not null,
  storage_path text not null unique,
  mime_type text not null default 'image/png' check (mime_type = 'image/png'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size between 80 and 1048576),
  consent_version text not null,
  consent_hash text not null check (consent_hash ~ '^[a-f0-9]{64}$'),
  consent_text text not null,
  consent_accepted_at timestamptz not null,
  signed_hash text not null check (signed_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb,
  constraint timesheet_document_signatures_submission_fk
    foreign key (organization_id, submission_id)
    references public.timesheet_submissions(organization_id, id) on delete restrict,
  constraint timesheet_document_signatures_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees(organization_id, id) on delete cascade,
  constraint timesheet_document_signatures_version_unique
    unique (organization_id, submission_id, submission_version)
);

alter table public.timesheet_submissions
  add column if not exists document_signature_id uuid references public.timesheet_document_signatures(id) on delete restrict,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_requested_by text,
  add column if not exists unsigned_exported_at timestamptz,
  add column if not exists unsigned_exported_by text,
  add column if not exists unsigned_export_checksum text,
  add column if not exists signed_exported_at timestamptz,
  add column if not exists signed_exported_by text,
  add column if not exists signed_export_checksum text;

create index if not exists timesheet_document_signatures_employee_idx
  on public.timesheet_document_signatures (organization_id, employee_id, created_at desc);
create index if not exists timesheet_document_signatures_submission_idx
  on public.timesheet_document_signatures (organization_id, submission_id, submission_version);
create index if not exists timesheet_submissions_approval_queue_idx
  on public.timesheet_submissions (organization_id, status, approval_requested_at desc)
  where status = 'submitted';

alter table public.timesheet_document_signatures enable row level security;
revoke all on public.timesheet_document_signatures from anon, authenticated;
grant all on public.timesheet_document_signatures to service_role;

drop policy if exists "deny anon document signatures" on public.timesheet_document_signatures;
create policy "deny anon document signatures"
  on public.timesheet_document_signatures for all to anon
  using (false) with check (false);

drop policy if exists "deny authenticated document signatures" on public.timesheet_document_signatures;
create policy "deny authenticated document signatures"
  on public.timesheet_document_signatures for all to authenticated
  using (false) with check (false);

comment on table public.timesheet_document_signatures is
  'One-time employee signature bound to one immutable timesheet snapshot and submission version.';
comment on column public.timesheet_document_signatures.consent_text is
  'Exact one-time confirmation text displayed immediately before the employee signed the document.';
comment on column public.timesheet_submissions.document_signature_id is
  'Current document-scoped signature used by the approved version; reusable employee_signatures are not required.';
comment on column public.timesheet_submissions.unsigned_export_checksum is
  'Latest checksum for an unsigned preview/export; an unsigned export does not lock the submission.';
comment on column public.timesheet_submissions.signed_export_checksum is
  'Latest checksum for the employee-approved signed export.';
