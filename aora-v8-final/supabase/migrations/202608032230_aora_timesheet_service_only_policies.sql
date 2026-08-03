create index if not exists employee_consent_requests_location_fk_idx
  on public.employee_consent_requests (organization_id, location_id);
create index if not exists employee_signatures_request_fk_idx
  on public.employee_signatures (consent_request_id);
create index if not exists timesheet_submissions_signature_fk_idx
  on public.timesheet_submissions (signature_id);

create policy "service only deny clients"
  on public.employee_consent_requests
  for all to anon, authenticated
  using (false)
  with check (false);
create policy "service only deny clients"
  on public.employee_document_consents
  for all to anon, authenticated
  using (false)
  with check (false);
create policy "service only deny clients"
  on public.employee_signatures
  for all to anon, authenticated
  using (false)
  with check (false);
