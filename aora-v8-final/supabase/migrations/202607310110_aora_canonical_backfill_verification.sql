begin;

create table if not exists public.canonical_backfill_verifications (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  migration_key text not null,
  legacy_counts jsonb not null default '{}'::jsonb,
  canonical_counts jsonb not null default '{}'::jsonb,
  differences jsonb not null default '{}'::jsonb,
  status text not null check (status in ('verified','warning','failed')),
  verified_at timestamptz not null default now(),
  primary key (organization_id,migration_key)
);
alter table public.canonical_backfill_verifications enable row level security;
revoke all on public.canonical_backfill_verifications from anon,authenticated;
grant all on public.canonical_backfill_verifications to service_role;
drop policy if exists edge_only_deny_direct on public.canonical_backfill_verifications;
create policy edge_only_deny_direct on public.canonical_backfill_verifications for all to anon,authenticated using(false) with check(false);

update public.locations
set address=coalesce(address,
      case when jsonb_typeof(payload->'address')='string' then nullif(payload->>'address','')
           when jsonb_typeof(payload->'address')='object' then nullif(concat_ws(' ',payload#>>'{address,street}',payload#>>'{address,houseNumber}'),'') end),
    country=coalesce(nullif(payload->>'country',''),country,'DE'),
    timezone=coalesce(nullif(payload->>'timezone',''),timezone,'Europe/Berlin'),
    latitude=coalesce(latitude,
      case when coalesce(payload#>>'{gps,lat}',payload->>'latitude') ~ '^-?[0-9]+([.][0-9]+)?$'
           then coalesce(payload#>>'{gps,lat}',payload->>'latitude')::numeric end),
    longitude=coalesce(longitude,
      case when coalesce(payload#>>'{gps,lng}',payload->>'longitude') ~ '^-?[0-9]+([.][0-9]+)?$'
           then coalesce(payload#>>'{gps,lng}',payload->>'longitude')::numeric end),
    geofence_radius=case when coalesce(payload->>'geofenceRadius','') ~ '^[0-9]+$' then (payload->>'geofenceRadius')::integer else geofence_radius end,
    updated_at=now();

update public.employees
set primary_location_id=coalesce(primary_location_id,location_id),
    role_title=coalesce(role_title,nullif(payload->>'roleTitle',''),nullif(role,'')),
    weekly_target_minutes=case
      when coalesce(payload->>'weeklyTargetMinutes','') ~ '^[0-9]+$' then (payload->>'weeklyTargetMinutes')::integer
      when coalesce(payload->>'weeklyTarget','') ~ '^[0-9]+([.][0-9]+)?$' then round((payload->>'weeklyTarget')::numeric*60)::integer
      else weekly_target_minutes end,
    vacation_allowance=case when coalesce(payload->>'vacationAllowance','') ~ '^[0-9]+([.][0-9]+)?$' then (payload->>'vacationAllowance')::numeric else vacation_allowance end,
    hourly_cost=case when coalesce(payload->>'hourlyCost','') ~ '^[0-9]+([.][0-9]+)?$' then (payload->>'hourlyCost')::numeric else hourly_cost end,
    version=greatest(version,coalesce(nullif(payload->>'version','')::integer,1)),
    updated_at=now();

insert into public.employee_location_access(organization_id,employee_id,location_id,access_level,created_by)
select organization_id,id,coalesce(primary_location_id,location_id),'member','canonical-backfill'
from public.employees
where deleted_at is null and coalesce(primary_location_id,location_id) is not null
on conflict (organization_id,employee_id,location_id) do nothing;

update public.shifts
set shift_date=coalesce(shift_date,case when payload->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (payload->>'date')::date end),
    starts_at=coalesce(starts_at,case when payload->>'start' ~ '^\d{2}:\d{2}' then (substring(payload->>'start' from 1 for 5))::time end),
    ends_at=coalesce(ends_at,case when payload->>'end' ~ '^\d{2}:\d{2}' then (substring(payload->>'end' from 1 for 5))::time end),
    break_minutes=case when coalesce(payload->>'breakMinutes','') ~ '^[0-9]+$' then (payload->>'breakMinutes')::integer else break_minutes end,
    role_required=coalesce(role_required,nullif(payload->>'roleRequired','')),
    published_at=coalesce(published_at,nullif(payload->>'publishedAt','')::timestamptz),
    confirmation_deadline=coalesce(confirmation_deadline,nullif(payload->>'confirmationDeadline','')::timestamptz),
    version=greatest(version,coalesce(nullif(payload->>'version','')::integer,1)),
    created_by=coalesce(created_by,nullif(payload->>'createdBy','')),
    updated_by=coalesce(updated_by,nullif(payload->>'updatedBy','')),
    updated_at=now();

update public.shift_series
set recurrence_rule=coalesce(recurrence_rule,nullif(template->>'recurrenceRule',''),recurrence),
    start_time=coalesce(start_time,case when template->>'start' ~ '^\d{2}:\d{2}' then substring(template->>'start' from 1 for 5)::time end),
    end_time=coalesce(end_time,case when template->>'end' ~ '^\d{2}:\d{2}' then substring(template->>'end' from 1 for 5)::time end),
    break_minutes=case when coalesce(template->>'breakMinutes','') ~ '^[0-9]+$' then (template->>'breakMinutes')::integer else break_minutes end,
    active=(status='active' and deleted_at is null),
    updated_at=now();

update public.shift_requests request
set location_id=coalesce(request.location_id,shift.location_id),
    reason=coalesce(request.reason,nullif(request.payload->>'reason','')),
    decided_at=coalesce(request.decided_at,nullif(request.payload->>'decidedAt','')::timestamptz),
    decided_by=coalesce(request.decided_by,nullif(request.payload->>'decidedBy','')),
    updated_at=now()
from public.shifts shift
where shift.organization_id=request.organization_id and shift.id=request.shift_id;

update public.task_templates
set category=coalesce(nullif(payload->>'category',''),category,'custom'),
    version=greatest(version,source_version),
    created_by=coalesce(created_by,nullif(payload->>'createdBy','')),
    review_required=coalesce((payload->>'reviewRequired')::boolean,review_required,false),
    clockout_policy=case
      when payload->>'clockoutPolicy' in ('WARN_ONLY','MANAGER_OVERRIDE','STRICT_BLOCK') then payload->>'clockoutPolicy'
      when block_clock_out then 'MANAGER_OVERRIDE'
      else clockout_policy end,
    updated_at=now();

update public.task_template_items
set min_value=coalesce(min_value,case when config->>'min' ~ '^-?[0-9]+([.][0-9]+)?$' then (config->>'min')::numeric end),
    max_value=coalesce(max_value,case when config->>'max' ~ '^-?[0-9]+([.][0-9]+)?$' then (config->>'max')::numeric end),
    options=case when jsonb_typeof(config->'options')='array' then config->'options' else options end,
    visibility_rule=coalesce(config->'visibilityRule',visibility_rule,'{}'::jsonb),
    validation_rule=coalesce(config->'validationRule',validation_rule,'{}'::jsonb);

update public.task_instances instance
set template_version=greatest(instance.template_version,template.version),
    scheduled_for=coalesce(instance.scheduled_for,instance.due_at,(instance.instance_date::timestamp at time zone coalesce(location.timezone,'Europe/Berlin'))),
    blocking_clockout=coalesce(instance.blocking_clockout,template.clockout_policy in ('MANAGER_OVERRIDE','STRICT_BLOCK'),false),
    updated_at=now()
from public.task_templates template,public.locations location
where template.organization_id=instance.organization_id and template.id=instance.template_id
  and location.organization_id=instance.organization_id and location.id=instance.location_id;

update public.notifications
set location_id=coalesce(location_id,nullif(payload->>'locationId','')),
    type=coalesce(nullif(payload->>'type',''),type,'general'),
    title=coalesce(title,nullif(payload->>'title',''),'Aora'),
    body=coalesce(body,nullif(payload->>'body','')),
    related_entity_type=coalesce(related_entity_type,nullif(payload->>'relatedEntityType','')),
    related_entity_id=coalesce(related_entity_id,nullif(payload->>'relatedEntityId','')),
    read_at=case when read then coalesce(read_at,created_at,now()) else read_at end;

update public.time_entries entry
set start_time=coalesce(entry.start_time,
      case when entry.entry_date is not null and entry.payload->>'start' ~ '^\d{2}:\d{2}'
           then ((entry.entry_date::text||' '||substring(entry.payload->>'start' from 1 for 5))::timestamp at time zone coalesce(location.timezone,'Europe/Berlin')) end),
    end_time=coalesce(entry.end_time,
      case when entry.entry_date is not null and entry.payload->>'end' ~ '^\d{2}:\d{2}'
           then (((entry.entry_date + case when substring(entry.payload->>'end' from 1 for 5)::time < substring(entry.payload->>'start' from 1 for 5)::time then 1 else 0 end)::text||' '||substring(entry.payload->>'end' from 1 for 5))::timestamp at time zone coalesce(location.timezone,'Europe/Berlin')) end),
    break_minutes=case when coalesce(entry.payload->>'breakMinutes','') ~ '^[0-9]+$' then (entry.payload->>'breakMinutes')::integer else entry.break_minutes end,
    shift_id=coalesce(entry.shift_id,nullif(entry.payload->>'shiftId','')),
    source=coalesce(nullif(entry.payload->>'source',''),entry.source,'legacy'),
    updated_at=now()
from public.locations location
where location.organization_id=entry.organization_id and location.id=entry.location_id;

update public.time_entries
set duration_minutes=greatest(0,floor(extract(epoch from (end_time-start_time))/60)::integer-break_minutes)
where start_time is not null and end_time is not null;

insert into public.feature_flags(organization_id,flag_key,enabled,config)
select organization.id,flag.key,false,'{}'::jsonb
from public.organizations organization
cross join (values
  ('canonical_database'),('calendar_v2'),('schedule_board_v2'),('open_shift_marketplace'),
  ('task_automation'),('clockout_task_gate'),('web_push')
) flag(key)
on conflict (organization_id,location_id,flag_key) do nothing;

insert into public.feature_flag_rules(organization_id,flag_key,scope_type,enabled,rollout_percentage)
select organization.id,flag.key,'organization',false,100
from public.organizations organization
cross join (values
  ('canonical_database'),('calendar_v2'),('schedule_board_v2'),('open_shift_marketplace'),
  ('task_automation'),('clockout_task_gate'),('web_push')
) flag(key)
on conflict (organization_id,flag_key,scope_type,scope_value) do nothing;

insert into public.canonical_backfill_verifications(
  organization_id,migration_key,legacy_counts,canonical_counts,differences,status,verified_at
)
select organization.id,
  '202607310110_aora_canonical_backfill_verification',
  jsonb_build_object(
    'locations',jsonb_array_length(coalesce(snapshot.state->'locations','[]'::jsonb)),
    'employees',jsonb_array_length(coalesce(snapshot.state->'employees','[]'::jsonb)),
    'shifts',jsonb_array_length(coalesce(snapshot.state->'shifts','[]'::jsonb)),
    'timeEntries',jsonb_array_length(coalesce(snapshot.state->'timeEntries','[]'::jsonb)),
    'notifications',jsonb_array_length(coalesce(snapshot.state->'notifications','[]'::jsonb)),
    'taskTemplates',jsonb_array_length(coalesce(snapshot.state->'checklistTemplates','[]'::jsonb)),
    'taskInstances',jsonb_array_length(coalesce(snapshot.state->'checklistAssignments','[]'::jsonb))
  ),
  public.aora_verify_canonical_backfill(organization.id),
  jsonb_build_object(
    'locations',jsonb_array_length(coalesce(snapshot.state->'locations','[]'::jsonb))-(select count(*) from public.locations l where l.organization_id=organization.id and l.deleted_at is null),
    'employees',jsonb_array_length(coalesce(snapshot.state->'employees','[]'::jsonb))-(select count(*) from public.employees e where e.organization_id=organization.id and e.deleted_at is null),
    'shifts',jsonb_array_length(coalesce(snapshot.state->'shifts','[]'::jsonb))-(select count(*) from public.shifts s where s.organization_id=organization.id and s.deleted_at is null),
    'timeEntries',jsonb_array_length(coalesce(snapshot.state->'timeEntries','[]'::jsonb))-(select count(*) from public.time_entries t where t.organization_id=organization.id and t.deleted_at is null),
    'notifications',jsonb_array_length(coalesce(snapshot.state->'notifications','[]'::jsonb))-(select count(*) from public.notifications n where n.organization_id=organization.id and n.deleted_at is null)
  ),
  case when
    jsonb_array_length(coalesce(snapshot.state->'locations','[]'::jsonb))=(select count(*) from public.locations l where l.organization_id=organization.id and l.deleted_at is null)
    and jsonb_array_length(coalesce(snapshot.state->'employees','[]'::jsonb))=(select count(*) from public.employees e where e.organization_id=organization.id and e.deleted_at is null)
    and jsonb_array_length(coalesce(snapshot.state->'shifts','[]'::jsonb))=(select count(*) from public.shifts s where s.organization_id=organization.id and s.deleted_at is null)
    and jsonb_array_length(coalesce(snapshot.state->'timeEntries','[]'::jsonb))=(select count(*) from public.time_entries t where t.organization_id=organization.id and t.deleted_at is null)
    then 'verified' else 'warning' end,
  now()
from public.organizations organization
join public.workspace_snapshots snapshot on snapshot.organization_id=organization.id
on conflict (organization_id,migration_key) do update
set legacy_counts=excluded.legacy_counts,canonical_counts=excluded.canonical_counts,
    differences=excluded.differences,status=excluded.status,verified_at=excluded.verified_at;

insert into public.relational_backfill_runs(migration_key,completed_at,status,verification)
values (
  '202607310110_aora_canonical_backfill_verification',now(),'verified',
  jsonb_build_object(
    'organizations',(select count(*) from public.organizations),
    'verified',(select count(*) from public.canonical_backfill_verifications where migration_key='202607310110_aora_canonical_backfill_verification' and status='verified'),
    'warnings',(select count(*) from public.canonical_backfill_verifications where migration_key='202607310110_aora_canonical_backfill_verification' and status='warning')
  )
)
on conflict (migration_key) do update
set completed_at=excluded.completed_at,status=excluded.status,verification=excluded.verification;

commit;
