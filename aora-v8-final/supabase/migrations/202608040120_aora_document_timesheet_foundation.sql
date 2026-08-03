-- Minimal foundation for document-scoped Arbeitszeitnachweis workflows.
-- This intentionally does not create reusable employee signature or blanket-consent records.

alter table public.timesheet_submissions
  add column if not exists location_id text,
  add column if not exists date_from date,
  add column if not exists date_to date,
  add column if not exists sent_by text,
  add column if not exists sent_at timestamptz,
  add column if not exists employee_decision text,
  add column if not exists employee_decided_at timestamptz,
  add column if not exists employee_note text,
  add column if not exists signature_id uuid,
  add column if not exists snapshot_hash text,
  add column if not exists signed_hash text,
  add column if not exists exported_at timestamptz,
  add column if not exists exported_by text,
  add column if not exists export_format text,
  add column if not exists export_checksum text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.timesheet_submissions'::regclass
      and conname = 'timesheet_submissions_employee_decision_check'
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_employee_decision_check
      check (employee_decision is null or employee_decision in ('approved','declined'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.timesheet_submissions'::regclass
      and conname = 'timesheet_submissions_date_range_check'
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_date_range_check
      check (date_from is null or date_to is null or date_from <= date_to);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.timesheet_submissions'::regclass
      and conname = 'timesheet_submissions_snapshot_hash_check'
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_snapshot_hash_check
      check (snapshot_hash is null or snapshot_hash ~ '^[a-f0-9]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.timesheet_submissions'::regclass
      and conname = 'timesheet_submissions_signed_hash_check'
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_signed_hash_check
      check (signed_hash is null or signed_hash ~ '^[a-f0-9]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.timesheet_submissions'::regclass
      and conname = 'timesheet_submissions_export_format_check'
  ) then
    alter table public.timesheet_submissions
      add constraint timesheet_submissions_export_format_check
      check (export_format is null or export_format in ('pdf','xlsx'));
  end if;
end $$;

create index if not exists timesheet_submissions_employee_period_idx
  on public.timesheet_submissions (organization_id, employee_id, date_from desc, date_to desc);
create index if not exists timesheet_submissions_location_period_idx
  on public.timesheet_submissions (organization_id, location_id, date_from desc, date_to desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-signatures', 'employee-signatures', false, 1048576, array['image/png']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on column public.timesheet_submissions.signature_id is
  'Legacy-compatible nullable column. The document-scoped workflow uses document_signature_id and never stores a reusable signature reference.';
comment on column public.timesheet_submissions.snapshot_hash is
  'SHA-256 of the canonical immutable timesheet snapshot.';
comment on column public.timesheet_submissions.signed_hash is
  'SHA-256 binding the exact snapshot, one-time signature, consent, employee, version and approval time.';
comment on column public.timesheet_submissions.employee_note is
  'Employee correction request or optional approval note for this exact document version.';
