create or replace function public.aora_seed_ci_work_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rule_set_id uuid := gen_random_uuid();
  v_effective_from date := (clock_timestamp() at time zone 'Europe/Berlin')::date - 1;
begin
  if new.slug !~ '^aora-ci-[a-z0-9-]{6,54}$' or new.plan <> 'staging' then
    return new;
  end if;

  insert into public.work_rule_sets(
    id, organization_id, name, version, effective_from, active, timezone, created_at, created_by
  ) values (
    v_rule_set_id, new.id, 'Aora CI release rules', 1, v_effective_from, true,
    'Europe/Berlin', clock_timestamp(), 'github-oidc-ci'
  );

  insert into public.work_rules(
    organization_id, rule_set_id, rule_type, threshold_minutes, severity, parameters, active, created_at
  ) values
    (new.id, v_rule_set_id, 'INACTIVE_EMPLOYEE', null, 'block', '{"allowException":false}'::jsonb, true, clock_timestamp()),
    (new.id, v_rule_set_id, 'SHIFT_OVERLAP', null, 'block', '{"allowException":false}'::jsonb, true, clock_timestamp()),
    (new.id, v_rule_set_id, 'MAX_DAILY_WORK', 600, 'block', '{"allowException":false,"warningMinutes":480}'::jsonb, true, clock_timestamp()),
    (new.id, v_rule_set_id, 'MIN_BREAK_AFTER_6H', 30, 'block', '{"allowException":false,"triggerMinutes":360}'::jsonb, true, clock_timestamp()),
    (new.id, v_rule_set_id, 'MIN_BREAK_AFTER_9H', 45, 'block', '{"allowException":false,"triggerMinutes":540}'::jsonb, true, clock_timestamp()),
    (new.id, v_rule_set_id, 'MIN_REST_BETWEEN_SHIFTS', 660, 'block', '{"allowException":true,"reasonRequired":true}'::jsonb, true, clock_timestamp()),
    (new.id, v_rule_set_id, 'OVERNIGHT_SHIFT', null, 'hint', '{"allowException":false}'::jsonb, true, clock_timestamp()),
    (new.id, v_rule_set_id, 'DST_TRANSITION', null, 'confirm', '{"allowException":true,"reasonRequired":true}'::jsonb, true, clock_timestamp());

  return new;
end;
$$;

drop trigger if exists aora_seed_ci_work_rules_after_insert on public.organizations;
create trigger aora_seed_ci_work_rules_after_insert
after insert on public.organizations
for each row execute function public.aora_seed_ci_work_rules();
