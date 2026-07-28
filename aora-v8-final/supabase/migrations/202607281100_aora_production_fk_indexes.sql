-- Cover tenant foreign keys used by compliance, billing, retention, and rule queries.
create index if not exists billing_events_organization_id_idx
  on public.billing_events(organization_id);
create index if not exists compliance_exports_organization_id_idx
  on public.compliance_exports(organization_id);
create index if not exists data_export_requests_organization_id_idx
  on public.data_export_requests(organization_id);
create index if not exists deletion_requests_organization_id_idx
  on public.deletion_requests(organization_id);
create index if not exists pilot_backups_organization_id_idx
  on public.pilot_backups(organization_id);
create index if not exists subprocessors_organization_id_idx
  on public.subprocessors(organization_id);
create index if not exists work_rules_organization_id_idx
  on public.work_rules(organization_id);

