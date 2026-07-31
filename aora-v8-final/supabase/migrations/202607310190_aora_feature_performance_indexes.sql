begin;

-- Cover foreign keys used by calendar, scheduling, task automation and cleanup paths.
create index if not exists employees_primary_location_fk_idx
  on public.employees(organization_id, primary_location_id)
  where primary_location_id is not null;

create index if not exists scheduler_runs_organization_fk_idx
  on public.scheduler_runs(organization_id)
  where organization_id is not null;

create index if not exists shift_requests_location_fk_idx
  on public.shift_requests(organization_id, location_id)
  where location_id is not null;

create index if not exists task_claims_employee_fk_idx
  on public.task_claims(organization_id, employee_id);

create index if not exists task_evidence_location_fk_idx
  on public.task_evidence(organization_id, location_id);

create index if not exists task_generation_keys_employee_fk_idx
  on public.task_generation_keys(organization_id, employee_id)
  where employee_id is not null;

create index if not exists task_generation_keys_instance_fk_idx
  on public.task_generation_keys(organization_id, task_instance_id)
  where task_instance_id is not null;

create index if not exists task_rules_location_fk_idx
  on public.task_rules(organization_id, location_id);

create index if not exists task_rules_template_fk_idx
  on public.task_rules(organization_id, template_id);

create index if not exists time_entries_shift_fk_idx
  on public.time_entries(organization_id, shift_id)
  where shift_id is not null;

commit;
