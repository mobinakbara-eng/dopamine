-- Cover every production foreign key reported by the Supabase advisor.
-- CREATE INDEX is intentionally idempotent so the migration can be replayed safely.

create index if not exists aora_invite_links_org_idx
  on public.aora_hardening_invite_links (organization_id);

create index if not exists app_sessions_org_idx
  on public.app_sessions (organization_id);

create index if not exists employees_primary_location_idx
  on public.employees (organization_id, primary_location_id);

create index if not exists kiosk_devices_org_location_idx
  on public.kiosk_devices (organization_id, location_id);

create index if not exists kiosk_sessions_org_device_idx
  on public.kiosk_sessions (organization_id, device_id);

create index if not exists kiosk_sessions_org_idx
  on public.kiosk_sessions (organization_id);

create index if not exists legal_documents_org_idx
  on public.legal_documents (organization_id);

create index if not exists organization_memberships_invited_by_idx
  on public.organization_memberships (invited_by);

create index if not exists scheduler_runs_org_idx
  on public.scheduler_runs (organization_id);

create index if not exists shift_requests_org_location_idx
  on public.shift_requests (organization_id, location_id);

create index if not exists task_claims_org_employee_idx
  on public.task_claims (organization_id, employee_id);

create index if not exists task_evidence_org_location_idx
  on public.task_evidence (organization_id, location_id);

create index if not exists task_generation_keys_org_employee_idx
  on public.task_generation_keys (organization_id, employee_id);

create index if not exists task_generation_keys_org_task_idx
  on public.task_generation_keys (organization_id, task_instance_id);

create index if not exists task_rules_org_location_idx
  on public.task_rules (organization_id, location_id);

create index if not exists task_rules_org_template_idx
  on public.task_rules (organization_id, template_id);

create index if not exists time_entries_org_shift_idx
  on public.time_entries (organization_id, shift_id);

create index if not exists work_rules_org_idx
  on public.work_rules (organization_id);

create index if not exists workspace_events_actor_user_idx
  on public.workspace_events (actor_user_id);
