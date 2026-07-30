begin;

alter table public.admins add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.kiosk_devices add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.leave_requests add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.correction_requests add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.announcements add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.clock_requests add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.availability_rules add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.checklist_templates add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.checklist_assignments add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.daily_logs add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.timesheet_periods add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.staffing_requirements add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;
alter table public.shift_feedback add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_reason text;

create or replace function public.project_workspace_state(p_organization_id uuid,p_state jsonb)
returns void
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_now timestamptz:=clock_timestamp();
begin
  insert into public.company_settings(organization_id,company,settings,meta,updated_at)
  values(p_organization_id,coalesce(p_state->'company','{}'::jsonb),coalesce(p_state->'settings','{}'::jsonb),coalesce(p_state->'meta','{}'::jsonb),v_now)
  on conflict(organization_id) do update set company=excluded.company,settings=excluded.settings,meta=excluded.meta,updated_at=excluded.updated_at;

  insert into public.locations(
    organization_id,id,name,city,active,payload,address,country,timezone,latitude,longitude,geofence_radius,
    created_at,updated_at,deleted_at,deleted_by,delete_reason
  )
  select p_organization_id,x->>'id',x->>'name',x->>'city',coalesce((x->>'active')::boolean,true),x,
    case when jsonb_typeof(x->'address')='string' then nullif(x->>'address','') else nullif(concat_ws(' ',x#>>'{address,street}',x#>>'{address,houseNumber}'),'') end,
    coalesce(nullif(x->>'country',''),'DE'),coalesce(nullif(x->>'timezone',''),'Europe/Berlin'),
    case when coalesce(x#>>'{gps,lat}',x->>'latitude') ~ '^-?[0-9]+([.][0-9]+)?$' then coalesce(x#>>'{gps,lat}',x->>'latitude')::numeric end,
    case when coalesce(x#>>'{gps,lng}',x->>'longitude') ~ '^-?[0-9]+([.][0-9]+)?$' then coalesce(x#>>'{gps,lng}',x->>'longitude')::numeric end,
    case when coalesce(x->>'geofenceRadius','') ~ '^[0-9]+$' then (x->>'geofenceRadius')::integer else 100 end,
    coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),v_now,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'locations','[]'::jsonb)) x
  where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set
    name=excluded.name,city=excluded.city,active=excluded.active,payload=excluded.payload,address=excluded.address,
    country=excluded.country,timezone=excluded.timezone,latitude=excluded.latitude,longitude=excluded.longitude,
    geofence_radius=excluded.geofence_radius,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
    deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  update public.locations target set active=false,deleted_at=coalesce(target.deleted_at,v_now),deleted_by=coalesce(target.deleted_by,'snapshot-compatibility'),delete_reason=coalesce(target.delete_reason,'Removed from compatibility snapshot')
  where target.organization_id=p_organization_id and target.deleted_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'locations','[]'::jsonb)) x where x->>'id'=target.id);

  insert into public.admins(organization_id,id,name,role,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'name',x->>'role',x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'admins','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set name=excluded.name,role=excluded.role,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;
  update public.admins target set deleted_at=coalesce(target.deleted_at,v_now),deleted_by=coalesce(target.deleted_by,'snapshot-compatibility'),delete_reason=coalesce(target.delete_reason,'Removed from compatibility snapshot')
  where target.organization_id=p_organization_id and target.deleted_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'admins','[]'::jsonb)) x where x->>'id'=target.id);

  insert into public.employees(
    organization_id,id,location_id,name,role,email,active,payload,primary_location_id,role_title,weekly_target_minutes,
    vacation_allowance,hourly_cost,version,created_at,updated_at,deleted_at,deleted_by,delete_reason
  )
  select p_organization_id,x->>'id',x->>'locationId',x->>'name',x->>'role',x->>'email',coalesce((x->>'active')::boolean,true),x,
    coalesce(x->>'primaryLocationId',x->>'locationId'),coalesce(x->>'roleTitle',x->>'role'),
    case when coalesce(x->>'weeklyTargetMinutes','') ~ '^[0-9]+$' then (x->>'weeklyTargetMinutes')::integer when coalesce(x->>'weeklyTarget','') ~ '^[0-9]+([.][0-9]+)?$' then round((x->>'weeklyTarget')::numeric*60)::integer else 0 end,
    case when coalesce(x->>'vacationAllowance','') ~ '^[0-9]+([.][0-9]+)?$' then (x->>'vacationAllowance')::numeric else 0 end,
    case when coalesce(x->>'hourlyCost','') ~ '^[0-9]+([.][0-9]+)?$' then (x->>'hourlyCost')::numeric end,
    greatest(coalesce(nullif(x->>'version','')::integer,1),1),coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),v_now,
    nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'employees','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set
    location_id=excluded.location_id,name=excluded.name,role=excluded.role,email=excluded.email,active=excluded.active,payload=excluded.payload,
    primary_location_id=excluded.primary_location_id,role_title=excluded.role_title,weekly_target_minutes=excluded.weekly_target_minutes,
    vacation_allowance=excluded.vacation_allowance,hourly_cost=excluded.hourly_cost,version=greatest(public.employees.version,excluded.version),
    updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;
  update public.employees target set active=false,deleted_at=coalesce(target.deleted_at,v_now),deleted_by=coalesce(target.deleted_by,'snapshot-compatibility'),delete_reason=coalesce(target.delete_reason,'Removed from compatibility snapshot')
  where target.organization_id=p_organization_id and target.deleted_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'employees','[]'::jsonb)) x where x->>'id'=target.id);

  insert into public.employee_location_access(organization_id,employee_id,location_id,access_level,created_by)
  select p_organization_id,x->>'id',coalesce(x->>'primaryLocationId',x->>'locationId'),'member','snapshot-projection'
  from jsonb_array_elements(coalesce(p_state->'employees','[]'::jsonb)) x
  where nullif(x->>'id','') is not null and nullif(coalesce(x->>'primaryLocationId',x->>'locationId'),'') is not null
  on conflict(organization_id,employee_id,location_id) do nothing;

  insert into public.kiosk_devices(organization_id,id,location_id,name,active,locked,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'locationId',x->>'name',coalesce((x->>'active')::boolean,true),coalesce((x->>'locked')::boolean,false),x,
    nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'kioskDevices','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set location_id=excluded.location_id,name=excluded.name,active=excluded.active,locked=excluded.locked,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;
  update public.kiosk_devices target set active=false,deleted_at=coalesce(target.deleted_at,v_now),deleted_by=coalesce(target.deleted_by,'snapshot-compatibility'),delete_reason=coalesce(target.delete_reason,'Removed from compatibility snapshot')
  where target.organization_id=p_organization_id and target.deleted_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'kioskDevices','[]'::jsonb)) x where x->>'id'=target.id);

  insert into public.shifts(
    organization_id,id,employee_id,location_id,shift_date,status,payload,series_id,starts_at,ends_at,break_minutes,
    role_required,published_at,confirmation_deadline,version,created_by,updated_by,created_at,updated_at,deleted_at,deleted_by,delete_reason
  )
  select p_organization_id,x->>'id',nullif(x->>'employeeId',''),x->>'locationId',nullif(x->>'date','')::date,coalesce(nullif(x->>'status',''),'draft'),x,
    nullif(coalesce(x->>'seriesId',x->>'shiftSeriesId'),''),case when x->>'start' ~ '^\d{2}:\d{2}' then substring(x->>'start' from 1 for 5)::time end,
    case when x->>'end' ~ '^\d{2}:\d{2}' then substring(x->>'end' from 1 for 5)::time end,
    case when coalesce(x->>'breakMinutes','') ~ '^[0-9]+$' then (x->>'breakMinutes')::integer else 0 end,
    x->>'roleRequired',nullif(x->>'publishedAt','')::timestamptz,nullif(x->>'confirmationDeadline','')::timestamptz,
    greatest(coalesce(nullif(x->>'version','')::integer,1),1),x->>'createdBy',x->>'updatedBy',coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),v_now,
    nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'shifts','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set
    employee_id=excluded.employee_id,location_id=excluded.location_id,shift_date=excluded.shift_date,status=excluded.status,payload=excluded.payload,
    series_id=excluded.series_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,break_minutes=excluded.break_minutes,
    role_required=excluded.role_required,published_at=excluded.published_at,confirmation_deadline=excluded.confirmation_deadline,
    version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
    deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;
  update public.shifts target set status='cancelled',deleted_at=coalesce(target.deleted_at,v_now),deleted_by=coalesce(target.deleted_by,'snapshot-compatibility'),delete_reason=coalesce(target.delete_reason,'Removed from compatibility snapshot')
  where target.organization_id=p_organization_id and target.deleted_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'shifts','[]'::jsonb)) x where x->>'id'=target.id);

  insert into public.time_entries(
    organization_id,id,employee_id,location_id,entry_date,status,version,payload,shift_id,start_time,end_time,break_minutes,duration_minutes,source,
    created_at,updated_at,deleted_at,deleted_by,delete_reason
  )
  select p_organization_id,x->>'id',x->>'employeeId',x->>'locationId',nullif(x->>'date','')::date,x->>'status',greatest(coalesce(nullif(x->>'version','')::integer,1),1),x,
    nullif(x->>'shiftId',''),
    case when x->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and x->>'start' ~ '^\d{2}:\d{2}' then ((x->>'date'||' '||substring(x->>'start' from 1 for 5))::timestamp at time zone coalesce(location.timezone,'Europe/Berlin')) end,
    case when x->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and x->>'start' ~ '^\d{2}:\d{2}' and x->>'end' ~ '^\d{2}:\d{2}' then (((x->>'date')::date + case when substring(x->>'end' from 1 for 5)::time < substring(x->>'start' from 1 for 5)::time then 1 else 0 end)::text||' '||substring(x->>'end' from 1 for 5))::timestamp at time zone coalesce(location.timezone,'Europe/Berlin') end,
    case when coalesce(x->>'breakMinutes','') ~ '^[0-9]+$' then (x->>'breakMinutes')::integer else 0 end,
    case when coalesce(x->>'durationMinutes','') ~ '^[0-9]+$' then (x->>'durationMinutes')::integer else 0 end,
    coalesce(nullif(x->>'source',''),'legacy'),coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),v_now,
    nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'timeEntries','[]'::jsonb)) x
  left join public.locations location on location.organization_id=p_organization_id and location.id=x->>'locationId'
  where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set employee_id=excluded.employee_id,location_id=excluded.location_id,entry_date=excluded.entry_date,
    status=excluded.status,version=excluded.version,payload=excluded.payload,shift_id=excluded.shift_id,start_time=excluded.start_time,
    end_time=excluded.end_time,break_minutes=excluded.break_minutes,duration_minutes=case when excluded.start_time is not null and excluded.end_time is not null then greatest(0,floor(extract(epoch from(excluded.end_time-excluded.start_time))/60)::integer-excluded.break_minutes) else excluded.duration_minutes end,
    source=excluded.source,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;
  update public.time_entries target set deleted_at=coalesce(target.deleted_at,v_now),deleted_by=coalesce(target.deleted_by,'snapshot-compatibility'),delete_reason=coalesce(target.delete_reason,'Removed from compatibility snapshot')
  where target.organization_id=p_organization_id and target.deleted_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'timeEntries','[]'::jsonb)) x where x->>'id'=target.id);

  insert into public.leave_requests(organization_id,id,employee_id,starts_on,ends_on,status,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'employeeId',nullif(x->>'start','')::date,nullif(x->>'end','')::date,x->>'status',x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'leaveRequests','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set employee_id=excluded.employee_id,starts_on=excluded.starts_on,ends_on=excluded.ends_on,status=excluded.status,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.correction_requests(organization_id,id,employee_id,entry_id,status,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'employeeId',x->>'entryId',x->>'status',x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'correctionRequests','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set employee_id=excluded.employee_id,entry_id=excluded.entry_id,status=excluded.status,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.announcements(organization_id,id,audience,created_at,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'audience',coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'announcements','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set audience=excluded.audience,created_at=excluded.created_at,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.notifications(organization_id,id,employee_id,location_id,type,title,body,related_entity_type,related_entity_id,read,read_at,created_at,payload,idempotency_key,deleted_at)
  select p_organization_id,x->>'id',x->>'employeeId',x->>'locationId',coalesce(nullif(x->>'type',''),'general'),x->>'title',x->>'body',x->>'relatedEntityType',x->>'relatedEntityId',coalesce((x->>'read')::boolean,false),nullif(x->>'readAt','')::timestamptz,coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),x,x->>'idempotencyKey',nullif(x->>'deletedAt','')::timestamptz
  from jsonb_array_elements(coalesce(p_state->'notifications','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set employee_id=excluded.employee_id,location_id=excluded.location_id,type=excluded.type,title=excluded.title,body=excluded.body,related_entity_type=excluded.related_entity_type,related_entity_id=excluded.related_entity_id,read=excluded.read,read_at=excluded.read_at,payload=excluded.payload,idempotency_key=excluded.idempotency_key,deleted_at=excluded.deleted_at;

  insert into public.audit_logs(organization_id,id,location_id,action,actor,actor_type,actor_id,entity,entity_type,entity_id,created_at,payload,before_json,after_json,metadata)
  select p_organization_id,x->>'id',coalesce(x->>'locationId',x#>>'{metadata,locationId}'),x->>'action',x->>'actor',x->>'actorType',x->>'actorId',x->>'entity',x->>'entityType',x->>'entityId',coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),x,x->'before',x->'after',coalesce(x->'metadata','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_state->'audit','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do nothing;

  insert into public.clock_requests(organization_id,id,employee_id,location_id,status,expires_at,version,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'employeeId',x->>'locationId',x->>'status',nullif(x->>'expiresAt','')::timestamptz,greatest(coalesce(nullif(x->>'version','')::integer,1),1),x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'clockRequests','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set employee_id=excluded.employee_id,location_id=excluded.location_id,status=excluded.status,expires_at=excluded.expires_at,version=excluded.version,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.availability_rules(organization_id,id,employee_id,rule_type,starts_on,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'employeeId',coalesce(x->>'type','available'),nullif(coalesce(x->>'date',x->>'startsOn'),'')::date,x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'availabilityRules','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set employee_id=excluded.employee_id,rule_type=excluded.rule_type,starts_on=excluded.starts_on,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.shift_requests(organization_id,id,shift_id,employee_id,location_id,request_type,status,reason,created_at,decided_at,decided_by,idempotency_key,updated_at,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'shiftId',x->>'employeeId',x->>'locationId',coalesce(nullif(x->>'requestType',''),nullif(x->>'type',''),'open_shift_claim'),coalesce(nullif(x->>'status',''),'pending'),x->>'reason',coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),nullif(x->>'decidedAt','')::timestamptz,x->>'decidedBy',case when coalesce(x->>'idempotencyKey','') ~ '^[0-9a-fA-F-]{36}$' then (x->>'idempotencyKey')::uuid end,v_now,x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'shiftRequests','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set shift_id=excluded.shift_id,employee_id=excluded.employee_id,location_id=excluded.location_id,request_type=excluded.request_type,status=excluded.status,reason=excluded.reason,decided_at=excluded.decided_at,decided_by=excluded.decided_by,idempotency_key=excluded.idempotency_key,updated_at=excluded.updated_at,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;
  update public.shift_requests target set status='withdrawn',deleted_at=coalesce(target.deleted_at,v_now),deleted_by=coalesce(target.deleted_by,'snapshot-compatibility'),delete_reason=coalesce(target.delete_reason,'Removed from compatibility snapshot')
  where target.organization_id=p_organization_id and target.deleted_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'shiftRequests','[]'::jsonb)) x where x->>'id'=target.id);

  insert into public.checklist_templates(organization_id,id,location_id,title,active,version,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'locationId',x->>'title',coalesce((x->>'active')::boolean,true),greatest(coalesce(nullif(x->>'version','')::integer,1),1),x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'checklistTemplates','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set location_id=excluded.location_id,title=excluded.title,active=excluded.active,version=excluded.version,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.task_templates(organization_id,id,location_id,title,description,category,recurrence,block_clock_out,active,source_version,version,created_by,review_required,clockout_policy,payload,created_at,updated_at,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'locationId',x->>'title',x->>'description',coalesce(nullif(x->>'category',''),'custom'),coalesce(nullif(x->>'recurrence',''),'manual'),coalesce((x->>'blockClockOut')::boolean,false),coalesce((x->>'active')::boolean,true),greatest(coalesce(nullif(x->>'version','')::integer,1),1),greatest(coalesce(nullif(x->>'version','')::integer,1),1),x->>'createdBy',coalesce((x->>'reviewRequired')::boolean,false),case when x->>'clockoutPolicy' in ('WARN_ONLY','MANAGER_OVERRIDE','STRICT_BLOCK') then x->>'clockoutPolicy' when coalesce((x->>'blockClockOut')::boolean,false) then 'MANAGER_OVERRIDE' else 'WARN_ONLY' end,x,coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),v_now,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'checklistTemplates','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set location_id=excluded.location_id,title=excluded.title,description=excluded.description,category=excluded.category,recurrence=excluded.recurrence,block_clock_out=excluded.block_clock_out,active=excluded.active,source_version=excluded.source_version,version=excluded.version,review_required=excluded.review_required,clockout_policy=excluded.clockout_policy,payload=excluded.payload,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.task_template_items(organization_id,template_id,id,position,label,answer_type,required,min_value,max_value,options,visibility_rule,validation_rule,config)
  select p_organization_id,template->>'id',coalesce(item.value->>'id','item_'||item.ordinality),item.ordinality-1,coalesce(item.value->>'label','Aufgabe'),
    case when item.value->>'type' in ('checkbox','text','number','photo','select') then item.value->>'type' else 'text' end,
    coalesce((item.value->>'required')::boolean,false),case when item.value->>'minValue' ~ '^-?[0-9]+([.][0-9]+)?$' then (item.value->>'minValue')::numeric end,case when item.value->>'maxValue' ~ '^-?[0-9]+([.][0-9]+)?$' then (item.value->>'maxValue')::numeric end,
    case when jsonb_typeof(item.value->'options')='array' then item.value->'options' else '[]'::jsonb end,coalesce(item.value->'visibilityRule','{}'::jsonb),coalesce(item.value->'validationRule','{}'::jsonb),item.value
  from jsonb_array_elements(coalesce(p_state->'checklistTemplates','[]'::jsonb)) template
  cross join lateral jsonb_array_elements(coalesce(template->'items','[]'::jsonb)) with ordinality item(value,ordinality)
  where nullif(template->>'id','') is not null
  on conflict(organization_id,template_id,id) do update set position=excluded.position,label=excluded.label,answer_type=excluded.answer_type,required=excluded.required,min_value=excluded.min_value,max_value=excluded.max_value,options=excluded.options,visibility_rule=excluded.visibility_rule,validation_rule=excluded.validation_rule,config=excluded.config;

  insert into public.checklist_assignments(organization_id,id,template_id,employee_id,location_id,assignment_date,status,version,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'templateId',x->>'employeeId',x->>'locationId',nullif(coalesce(x->>'date',x->>'assignmentDate'),'')::date,coalesce(nullif(x->>'status',''),'open'),greatest(coalesce(nullif(x->>'version','')::integer,1),1),x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'checklistAssignments','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set template_id=excluded.template_id,employee_id=excluded.employee_id,location_id=excluded.location_id,assignment_date=excluded.assignment_date,status=excluded.status,version=excluded.version,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.task_instances(organization_id,id,template_id,template_version,location_id,shift_id,instance_date,scheduled_for,due_at,status,blocking_clockout,version,completed_at,payload,created_at,updated_at,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'templateId',greatest(coalesce(nullif(x->>'templateVersion','')::integer,1),1),x->>'locationId',x->>'shiftId',nullif(coalesce(x->>'date',x->>'assignmentDate'),'')::date,
    coalesce(nullif(x->>'scheduledFor','')::timestamptz,nullif(x->>'dueAt','')::timestamptz),nullif(x->>'dueAt','')::timestamptz,
    case when x->>'status' in ('open','in_progress','submitted','completed','rejected','overdue','waived','cancelled') then x->>'status' when x->>'status'='complete' then 'completed' else 'open' end,
    coalesce((x->>'blockingClockout')::boolean,false),greatest(coalesce(nullif(x->>'version','')::integer,1),1),nullif(x->>'completedAt','')::timestamptz,x,coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),v_now,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason'
  from jsonb_array_elements(coalesce(p_state->'checklistAssignments','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set template_id=excluded.template_id,template_version=excluded.template_version,location_id=excluded.location_id,shift_id=excluded.shift_id,instance_date=excluded.instance_date,scheduled_for=excluded.scheduled_for,due_at=excluded.due_at,status=excluded.status,blocking_clockout=excluded.blocking_clockout,version=excluded.version,completed_at=excluded.completed_at,payload=excluded.payload,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.task_assignments(organization_id,task_instance_id,employee_id,assigned_at,accepted_at,completed_at,status)
  select p_organization_id,x->>'id',x->>'employeeId',coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),nullif(x->>'acceptedAt','')::timestamptz,nullif(x->>'completedAt','')::timestamptz,
    case when x->>'status' in ('completed','complete') then 'completed' when x->>'status'='in_progress' then 'in_progress' else 'assigned' end
  from jsonb_array_elements(coalesce(p_state->'checklistAssignments','[]'::jsonb)) x
  where nullif(x->>'id','') is not null and nullif(x->>'employeeId','') is not null
  on conflict(organization_id,task_instance_id,employee_id) do update set accepted_at=excluded.accepted_at,completed_at=excluded.completed_at,status=excluded.status;

  insert into public.daily_logs(organization_id,id,location_id,log_date,category,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'locationId',nullif(x->>'date','')::date,x->>'category',x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason' from jsonb_array_elements(coalesce(p_state->'dailyLogs','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set location_id=excluded.location_id,log_date=excluded.log_date,category=excluded.category,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.timesheet_periods(organization_id,id,period,status,version,locked_at,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'period',x->>'status',greatest(coalesce(nullif(x->>'version','')::integer,1),1),nullif(x->>'lockedAt','')::timestamptz,x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason' from jsonb_array_elements(coalesce(p_state->'timesheetPeriods','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set period=excluded.period,status=excluded.status,version=excluded.version,locked_at=excluded.locked_at,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.staffing_requirements(organization_id,id,location_id,day_of_week,minimum,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'locationId',coalesce((x->>'dayOfWeek')::smallint,1),coalesce((x->>'minimum')::integer,0),x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason' from jsonb_array_elements(coalesce(p_state->'staffingRequirements','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set location_id=excluded.location_id,day_of_week=excluded.day_of_week,minimum=excluded.minimum,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;

  insert into public.shift_feedback(organization_id,id,shift_id,employee_id,rating,created_at,payload,deleted_at,deleted_by,delete_reason)
  select p_organization_id,x->>'id',x->>'shiftId',x->>'employeeId',nullif(x->>'rating','')::smallint,coalesce(nullif(x->>'createdAt','')::timestamptz,v_now),x,nullif(x->>'deletedAt','')::timestamptz,x->>'deletedBy',x->>'deleteReason' from jsonb_array_elements(coalesce(p_state->'shiftFeedback','[]'::jsonb)) x where nullif(x->>'id','') is not null
  on conflict(organization_id,id) do update set shift_id=excluded.shift_id,employee_id=excluded.employee_id,rating=excluded.rating,created_at=excluded.created_at,payload=excluded.payload,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;
end;
$$;

-- Reproject every staging/production workspace through the safe function without changing snapshots.
do $$ declare row record; begin
  for row in select organization_id,state from public.workspace_snapshots loop
    perform public.project_workspace_state(row.organization_id,row.state);
  end loop;
end $$;

commit;
