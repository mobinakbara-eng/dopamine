create table if not exists public.work_rule_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  version integer not null check (version > 0),
  effective_from date not null,
  effective_to date null,
  active boolean not null default true,
  timezone text not null default 'Europe/Berlin',
  created_at timestamptz not null default now(),
  created_by text null,
  unique (organization_id, version),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists work_rule_sets_one_active_idx
  on public.work_rule_sets (organization_id)
  where active = true and effective_to is null;

create table if not exists public.work_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_set_id uuid not null references public.work_rule_sets(id) on delete cascade,
  rule_type text not null check (rule_type in (
    'MAX_DAILY_WORK','MAX_WEEKLY_WORK','MIN_BREAK_AFTER_6H','MIN_BREAK_AFTER_9H',
    'MIN_REST_BETWEEN_SHIFTS','SHIFT_OVERLAP','OVERNIGHT_SHIFT','DST_TRANSITION',
    'INACTIVE_EMPLOYEE','MINOR_EMPLOYEE'
  )),
  threshold_minutes integer null check (threshold_minutes is null or threshold_minutes >= 0),
  severity text not null check (severity in ('hint','confirm','block')),
  parameters jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (rule_set_id, rule_type)
);

create index if not exists work_rules_set_type_idx
  on public.work_rules (rule_set_id, rule_type)
  where active = true;

create table if not exists public.work_rule_evaluations (
  id uuid primary key,
  organization_id uuid not null,
  rule_set_id uuid not null,
  rule_set_version integer not null,
  entity_type text not null default 'shift',
  entity_id text null,
  employee_id text not null,
  location_id text not null,
  actor_type text not null,
  actor_id text null,
  input jsonb not null,
  violations jsonb not null default '[]'::jsonb,
  valid boolean not null,
  requires_confirmation boolean not null default false,
  override_reason text null,
  evaluated_at timestamptz not null default now()
);

create index if not exists work_rule_evaluations_org_employee_idx
  on public.work_rule_evaluations (organization_id, employee_id, evaluated_at desc);

alter table public.work_rule_sets enable row level security;
alter table public.work_rules enable row level security;
alter table public.work_rule_evaluations enable row level security;

revoke all on public.work_rule_sets from public, anon, authenticated;
revoke all on public.work_rules from public, anon, authenticated;
revoke all on public.work_rule_evaluations from public, anon, authenticated;
grant select, insert, update on public.work_rule_sets to service_role;
grant select, insert, update on public.work_rules to service_role;
grant select, insert on public.work_rule_evaluations to service_role;

with inserted_sets as (
  insert into public.work_rule_sets (
    organization_id, name, version, effective_from, active, timezone, created_by
  )
  select o.id, 'Aora Pilot Standard', 1, current_date, true, coalesce(nullif(o.timezone,''),'Europe/Berlin'), 'aora-8.1.0-pilot'
  from public.organizations o
  where o.status = 'active'
    and not exists (select 1 from public.work_rule_sets s where s.organization_id = o.id)
  returning id, organization_id
)
insert into public.work_rules (organization_id, rule_set_id, rule_type, threshold_minutes, severity, parameters)
select s.organization_id, s.id, v.rule_type, v.threshold_minutes, v.severity, v.parameters
from inserted_sets s
cross join (values
  ('INACTIVE_EMPLOYEE', null::integer, 'block', '{"allowException":false}'::jsonb),
  ('SHIFT_OVERLAP', null::integer, 'block', '{"allowException":false}'::jsonb),
  ('MAX_DAILY_WORK', 600, 'block', '{"allowException":false,"warningMinutes":480,"averagingRequired":true}'::jsonb),
  ('MIN_BREAK_AFTER_6H', 30, 'block', '{"triggerMinutes":360,"allowException":false}'::jsonb),
  ('MIN_BREAK_AFTER_9H', 45, 'block', '{"triggerMinutes":540,"allowException":false}'::jsonb),
  ('MIN_REST_BETWEEN_SHIFTS', 660, 'block', '{"allowException":true,"reasonRequired":true,"sectorOrTariffReviewRequired":true}'::jsonb),
  ('OVERNIGHT_SHIFT', null::integer, 'hint', '{"allowException":false}'::jsonb),
  ('DST_TRANSITION', null::integer, 'confirm', '{"allowException":true,"reasonRequired":true}'::jsonb),
  ('MAX_WEEKLY_WORK', 2880, 'hint', '{"enabled":false,"pilotNote":"Reporting only until rolling average is implemented"}'::jsonb),
  ('MINOR_EMPLOYEE', null::integer, 'hint', '{"enabled":false,"pilotNote":"Requires verified birth date and separate youth rules"}'::jsonb)
) as v(rule_type, threshold_minutes, severity, parameters);

create or replace function private.aora_local_timestamp(
  p_date date,
  p_time time without time zone,
  p_timezone text
)
returns timestamptz
language sql
immutable
set search_path = pg_catalog
as $$
  select make_timestamptz(
    extract(year from p_date)::integer,
    extract(month from p_date)::integer,
    extract(day from p_date)::integer,
    extract(hour from p_time)::integer,
    extract(minute from p_time)::integer,
    extract(second from p_time)::double precision,
    p_timezone
  );
$$;

create or replace function public.aora_evaluate_shift_rules(
  p_organization_id uuid,
  p_employee_id text,
  p_location_id text,
  p_date date,
  p_start time without time zone,
  p_end time without time zone,
  p_break_minutes integer default 0,
  p_existing_shifts jsonb default '[]'::jsonb,
  p_exclude_shift_id text default null,
  p_override_reason text default null,
  p_actor_type text default 'system',
  p_actor_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_set public.work_rule_sets%rowtype;
  v_rule public.work_rules%rowtype;
  v_employee public.employees%rowtype;
  v_timezone text;
  v_end_date date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_duration integer;
  v_wall_minutes integer;
  v_work_minutes integer;
  v_daily_work integer;
  v_dst_delta integer;
  v_overlap boolean := false;
  v_min_rest integer := null;
  v_overnight boolean;
  v_existing jsonb;
  v_existing_date date;
  v_existing_start time;
  v_existing_end time;
  v_existing_end_date date;
  v_existing_start_at timestamptz;
  v_existing_end_at timestamptz;
  v_existing_duration integer;
  v_existing_work integer;
  v_gap integer;
  v_trigger integer;
  v_violated boolean;
  v_actual integer;
  v_required integer;
  v_message text;
  v_allow_exception boolean;
  v_overridden boolean;
  v_valid boolean := true;
  v_requires_confirmation boolean := false;
  v_violations jsonb := '[]'::jsonb;
  v_eval_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  if p_break_minutes < 0 then raise exception 'break minutes cannot be negative'; end if;

  select * into v_set
  from public.work_rule_sets s
  where s.organization_id = p_organization_id
    and s.active = true
    and s.effective_from <= p_date
    and (s.effective_to is null or s.effective_to >= p_date)
  order by s.version desc
  limit 1;
  if v_set.id is null then raise exception 'no active work rule set for organization'; end if;

  v_timezone := coalesce(nullif(v_set.timezone,''),'Europe/Berlin');
  v_end_date := p_date + case when p_end <= p_start then 1 else 0 end;
  v_start_at := private.aora_local_timestamp(p_date,p_start,v_timezone);
  v_end_at := private.aora_local_timestamp(v_end_date,p_end,v_timezone);
  v_duration := greatest(0, floor(extract(epoch from (v_end_at-v_start_at))/60)::integer);
  v_wall_minutes := greatest(0, floor(extract(epoch from ((v_end_date+p_end)-(p_date+p_start)))/60)::integer);
  v_dst_delta := v_duration-v_wall_minutes;
  v_work_minutes := greatest(0,v_duration-p_break_minutes);
  v_daily_work := v_work_minutes;
  v_overnight := v_end_date > p_date;

  select * into v_employee
  from public.employees e
  where e.organization_id = p_organization_id and e.id = p_employee_id
  limit 1;

  for v_existing in select value from jsonb_array_elements(coalesce(p_existing_shifts,'[]'::jsonb))
  loop
    begin
      if coalesce(v_existing->>'employeeId','') <> p_employee_id then continue; end if;
      if p_exclude_shift_id is not null and v_existing->>'id' = p_exclude_shift_id then continue; end if;
      v_existing_date := (v_existing->>'date')::date;
      v_existing_start := (v_existing->>'start')::time;
      v_existing_end := (v_existing->>'end')::time;
      v_existing_end_date := v_existing_date + case when v_existing_end <= v_existing_start then 1 else 0 end;
      v_existing_start_at := private.aora_local_timestamp(v_existing_date,v_existing_start,v_timezone);
      v_existing_end_at := private.aora_local_timestamp(v_existing_end_date,v_existing_end,v_timezone);
      v_existing_duration := greatest(0,floor(extract(epoch from (v_existing_end_at-v_existing_start_at))/60)::integer);
      v_existing_work := greatest(0,v_existing_duration-coalesce(nullif(v_existing->>'breakMinutes','')::integer,0));

      if v_start_at < v_existing_end_at and v_end_at > v_existing_start_at then
        v_overlap := true;
      elsif v_existing_end_at <= v_start_at then
        v_gap := floor(extract(epoch from (v_start_at-v_existing_end_at))/60)::integer;
        v_min_rest := case when v_min_rest is null then v_gap else least(v_min_rest,v_gap) end;
      elsif v_end_at <= v_existing_start_at then
        v_gap := floor(extract(epoch from (v_existing_start_at-v_end_at))/60)::integer;
        v_min_rest := case when v_min_rest is null then v_gap else least(v_min_rest,v_gap) end;
      end if;
      if v_existing_date = p_date then v_daily_work := v_daily_work + v_existing_work; end if;
    exception when others then null;
    end;
  end loop;

  for v_rule in select * from public.work_rules r where r.rule_set_id = v_set.id and r.active = true order by r.rule_type
  loop
    v_violated := false;
    v_actual := null;
    v_required := v_rule.threshold_minutes;
    v_message := v_rule.rule_type;
    case v_rule.rule_type
      when 'INACTIVE_EMPLOYEE' then
        v_violated := v_employee.id is null or v_employee.active is not true;
        v_message := 'Mitarbeiter ist nicht aktiv oder gehört nicht zu dieser Organisation.';
      when 'SHIFT_OVERLAP' then
        v_violated := v_overlap;
        v_message := 'Die Schicht überschneidet sich mit einer bestehenden Schicht.';
      when 'MAX_DAILY_WORK' then
        v_actual := v_daily_work;
        v_violated := v_daily_work > coalesce(v_rule.threshold_minutes,600);
        v_message := format('Die tägliche Arbeitszeit beträgt %s Minuten; zulässig sind in diesem Regelset höchstens %s Minuten.',v_daily_work,coalesce(v_rule.threshold_minutes,600));
      when 'MIN_BREAK_AFTER_6H' then
        v_trigger := coalesce((v_rule.parameters->>'triggerMinutes')::integer,360);
        v_actual := p_break_minutes;
        v_violated := v_work_minutes + p_break_minutes > v_trigger and p_break_minutes < coalesce(v_rule.threshold_minutes,30);
        v_message := format('Bei mehr als 6 Stunden sind mindestens %s Minuten Pause erforderlich.',coalesce(v_rule.threshold_minutes,30));
      when 'MIN_BREAK_AFTER_9H' then
        v_trigger := coalesce((v_rule.parameters->>'triggerMinutes')::integer,540);
        v_actual := p_break_minutes;
        v_violated := v_work_minutes + p_break_minutes > v_trigger and p_break_minutes < coalesce(v_rule.threshold_minutes,45);
        v_message := format('Bei mehr als 9 Stunden sind mindestens %s Minuten Pause erforderlich.',coalesce(v_rule.threshold_minutes,45));
      when 'MIN_REST_BETWEEN_SHIFTS' then
        v_actual := v_min_rest;
        v_violated := v_min_rest is not null and v_min_rest < coalesce(v_rule.threshold_minutes,660);
        v_message := format('Zwischen den Schichten liegen nur %s Minuten; erforderlich sind %s Minuten.',coalesce(v_min_rest,0),coalesce(v_rule.threshold_minutes,660));
      when 'OVERNIGHT_SHIFT' then
        v_violated := v_overnight;
        v_message := 'Die Schicht endet am Folgetag und wird als Nachtschicht ausgewertet.';
      when 'DST_TRANSITION' then
        v_actual := v_duration;
        v_required := v_wall_minutes;
        v_violated := v_dst_delta <> 0;
        v_message := format('Zeitumstellung erkannt: reale Dauer %s Minuten, lokale Uhrzeitdifferenz %s Minuten.',v_duration,v_wall_minutes);
      else
        v_violated := false;
    end case;

    if v_violated then
      v_allow_exception := coalesce((v_rule.parameters->>'allowException')::boolean,false);
      v_overridden := v_allow_exception and length(trim(coalesce(p_override_reason,''))) >= 5;
      if v_rule.severity = 'block' and not v_overridden then v_valid := false; end if;
      if v_rule.severity = 'confirm' and not v_overridden then v_valid := false; v_requires_confirmation := true; end if;
      if v_allow_exception and not v_overridden and v_rule.severity = 'block' then v_requires_confirmation := true; end if;
      v_violations := v_violations || jsonb_build_array(jsonb_build_object(
        'rule',v_rule.rule_type,'severity',v_rule.severity,'requiredMinutes',v_required,'actualMinutes',v_actual,
        'allowException',v_allow_exception,'overridden',v_overridden,'message',v_message
      ));
    end if;
  end loop;

  v_result := jsonb_build_object(
    'evaluationId',v_eval_id,'valid',v_valid,'requiresConfirmation',v_requires_confirmation,
    'ruleSetId',v_set.id,'ruleSetVersion',v_set.version,'timezone',v_timezone,
    'startAt',v_start_at,'endAt',v_end_at,'durationMinutes',v_duration,'wallClockMinutes',v_wall_minutes,
    'workMinutes',v_work_minutes,'dailyWorkMinutes',v_daily_work,'dstDeltaMinutes',v_dst_delta,
    'overnight',v_overnight,'violations',v_violations
  );

  insert into public.work_rule_evaluations (
    id,organization_id,rule_set_id,rule_set_version,employee_id,location_id,
    actor_type,actor_id,input,violations,valid,requires_confirmation,override_reason
  ) values (
    v_eval_id,p_organization_id,v_set.id,v_set.version,p_employee_id,p_location_id,p_actor_type,p_actor_id,
    jsonb_build_object('date',p_date,'start',p_start,'end',p_end,'breakMinutes',p_break_minutes,'excludeShiftId',p_exclude_shift_id),
    v_violations,v_valid,v_requires_confirmation,nullif(trim(coalesce(p_override_reason,'')),'')
  );
  return v_result;
end;
$$;

revoke all on function private.aora_local_timestamp(date,time,text) from public, anon, authenticated;
revoke all on function public.aora_evaluate_shift_rules(uuid,text,text,date,time,time,integer,jsonb,text,text,text,text) from public, anon, authenticated;
grant execute on function private.aora_local_timestamp(date,time,text) to service_role;
grant execute on function public.aora_evaluate_shift_rules(uuid,text,text,date,time,time,integer,jsonb,text,text,text,text) to service_role;