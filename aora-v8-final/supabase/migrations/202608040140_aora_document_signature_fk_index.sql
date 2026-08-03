-- Cover the nullable foreign key used to resolve the signed document version.
create index if not exists timesheet_submissions_document_signature_idx
  on public.timesheet_submissions (document_signature_id)
  where document_signature_id is not null;
