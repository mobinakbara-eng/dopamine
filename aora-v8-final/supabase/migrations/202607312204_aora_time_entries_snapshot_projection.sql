begin;

create or replace function public.aora_project_time_entries_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_now timestamptz := clock_timestamp();
begin
  insert into public.time_entries(
    organization_id,
    id,
    employee_id,
    location_id,
    entry_date,
    status,
    version,
    payload,
    shift_id,
    start_time,
    end_time,
    break_minutes,
    duration_minutes,
    source,
    created_at,
    updated_at,
    deleted_at,
    deleted_by,
    delete_reason
  )
  select
    new.organization_id,
    item->>'id',
    item->>'employeeId',
    item->>'locationId',
    nullif(item->>'date', '')::date,
    item->>'status',
    greatest(coalesce(nullif(item->>'version', '')::integer, 1), 1),
    item,
    nullif(item->>'shiftId', ''),
    case
      when item->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
       and item->>'start' ~ '^\d{2}:\d{2}'
      then ((item->>'date' || ' ' || substring(item->>'start' from 1 for 5))::timestamp
        at time zone coalesce(location.timezone, 'Europe/Berlin'))
    end,
    case
      when item->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
       and item->>'start' ~ '^\d{2}:\d{2}'
       and item->>'end' ~ '^\d{2}:\d{2}'
      then (
        (
          ((item->>'date')::date
            + case
                when substring(item->>'end' from 1 for 5)::time
                   < substring(item->>'start' from 1 for 5)::time
                then 1 else 0
              end
          )::text
          || ' '
          || substring(item->>'end' from 1 for 5)
        )::timestamp
        at time zone coalesce(location.timezone, 'Europe/Berlin')
      )
    end,
    case
      when coalesce(item->>'breakMinutes', '') ~ '^[0-9]+$'
      then (item->>'breakMinutes')::integer
      else 0
    end,
    case
      when coalesce(item->>'durationMinutes', '') ~ '^[0-9]+$'
      then (item->>'durationMinutes')::integer
      else 0
    end,
    coalesce(nullif(item->>'source', ''), 'legacy'),
    coalesce(nullif(item->>'createdAt', '')::timestamptz, v_now),
    v_now,
    nullif(item->>'deletedAt', '')::timestamptz,
    item->>'deletedBy',
    item->>'deleteReason'
  from jsonb_array_elements(coalesce(new.state->'timeEntries', '[]'::jsonb)) item
  left join public.locations location
    on location.organization_id = new.organization_id
   and location.id = item->>'locationId'
  where nullif(item->>'id', '') is not null
  on conflict (organization_id, id) do update
  set employee_id = excluded.employee_id,
      location_id = excluded.location_id,
      entry_date = excluded.entry_date,
      status = excluded.status,
      version = excluded.version,
      payload = excluded.payload,
      shift_id = excluded.shift_id,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      break_minutes = excluded.break_minutes,
      duration_minutes = excluded.duration_minutes,
      source = excluded.source,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      deleted_by = excluded.deleted_by,
      delete_reason = excluded.delete_reason;

  update public.time_entries target
  set deleted_at = coalesce(target.deleted_at, v_now),
      deleted_by = coalesce(target.deleted_by, 'snapshot-projection'),
      delete_reason = coalesce(target.delete_reason, 'Removed from workspace snapshot'),
      updated_at = v_now
  where target.organization_id = new.organization_id
    and target.deleted_at is null
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(new.state->'timeEntries', '[]'::jsonb)) item
      where item->>'id' = target.id
    );

  return new;
end;
$function$;

revoke all on function public.aora_project_time_entries_snapshot_trigger() from public, anon, authenticated;
grant execute on function public.aora_project_time_entries_snapshot_trigger() to service_role;

drop trigger if exists aora_project_time_entries_after_write on public.workspace_snapshots;
create trigger aora_project_time_entries_after_write
after insert or update of state on public.workspace_snapshots
for each row
execute function public.aora_project_time_entries_snapshot_trigger();

update public.workspace_snapshots
set state = state
where state ? 'timeEntries';

commit;
