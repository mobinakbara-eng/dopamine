begin;

create index if not exists shift_reservations_employee_idx
  on public.shift_reservations(organization_id, employee_id);
create index if not exists shift_reservations_location_idx
  on public.shift_reservations(organization_id, location_id);
create index if not exists shift_series_employee_idx
  on public.shift_series(organization_id, employee_id)
  where employee_id is not null;
create index if not exists task_answers_assignment_idx
  on public.task_answers(organization_id, task_instance_id, employee_id);
create index if not exists task_instances_shift_idx
  on public.task_instances(organization_id, shift_id)
  where shift_id is not null;
create index if not exists task_instances_template_idx
  on public.task_instances(organization_id, template_id);
create index if not exists task_templates_location_idx
  on public.task_templates(organization_id, location_id)
  where location_id is not null;

drop policy if exists "deny direct push subscription access" on public.push_subscriptions;
create policy "deny direct push subscription access"
on public.push_subscriptions for all to anon, authenticated
using (false) with check (false);

drop policy if exists "deny direct backfill run access" on public.relational_backfill_runs;
create policy "deny direct backfill run access"
on public.relational_backfill_runs for all to anon, authenticated
using (false) with check (false);

commit;
