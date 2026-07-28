-- Production consistency: one backend-native login, explicit manager scope,
-- generic relational projection, and bounded server-side sessions.

create or replace function public.aora_sync_manager_location_access(
  p_organization_id uuid,
  p_state jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer;
begin
  delete from public.manager_location_access
  where organization_id = p_organization_id;

  insert into public.manager_location_access(
    organization_id, manager_id, membership_id, location_id, created_by
  )
  select
    p_organization_id,
    admin_item->>'id',
    membership.id,
    location_value,
    'snapshot-projection'
  from jsonb_array_elements(coalesce(p_state->'admins','[]'::jsonb)) admin_item
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(admin_item->'locationIds')='array' then admin_item->'locationIds'
      when nullif(admin_item->>'locationId','') is not null then jsonb_build_array(admin_item->>'locationId')
      else '[]'::jsonb
    end
  ) location_value
  join public.admins admin_row
    on admin_row.organization_id=p_organization_id
   and admin_row.id=admin_item->>'id'
  join public.locations location_row
    on location_row.organization_id=p_organization_id
   and location_row.id=location_value
  left join public.organization_memberships membership
    on membership.organization_id=p_organization_id
   and membership.admin_id=admin_item->>'id'
   and membership.status='active'
  where admin_item->>'scope'='manager'
    and coalesce(admin_item->>'active','true')<>'false'
    and coalesce(admin_item->>'status','active') not in ('revoked','suspended')
  on conflict(organization_id,manager_id,location_id) do update
  set membership_id=excluded.membership_id,
      created_at=clock_timestamp(),
      created_by=excluded.created_by;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.aora_sync_manager_location_access(uuid,jsonb)
from public, anon, authenticated;
grant execute on function public.aora_sync_manager_location_access(uuid,jsonb)
to service_role;

create or replace function public.aora_project_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists(
    select 1 from public.organizations
    where id=new.organization_id and status='active'
  ) then
    perform public.project_workspace_state(new.organization_id,new.state);
    perform public.aora_sync_manager_location_access(new.organization_id,new.state);
  end if;
  return new;
end;
$$;

revoke all on function public.aora_project_snapshot_trigger()
from public, anon, authenticated;
grant execute on function public.aora_project_snapshot_trigger()
to service_role;

drop trigger if exists aora_hardening_project_snapshot_after_update
on public.workspace_snapshots;
drop trigger if exists aora_project_snapshot_after_write
on public.workspace_snapshots;
create trigger aora_project_snapshot_after_write
after insert or update of state on public.workspace_snapshots
for each row
execute function public.aora_project_snapshot_trigger();

do $$
declare snapshot_row record;
begin
  for snapshot_row in
    select organization_id,state from public.workspace_snapshots
  loop
    perform public.project_workspace_state(snapshot_row.organization_id,snapshot_row.state);
    perform public.aora_sync_manager_location_access(snapshot_row.organization_id,snapshot_row.state);
  end loop;
end
$$;

create or replace function public.aora_trim_subject_sessions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.app_sessions session
  set revoked_at=coalesce(session.revoked_at,clock_timestamp())
  where session.id in (
    select id
    from public.app_sessions
    where organization_id=new.organization_id
      and role=new.role
      and subject_id=new.subject_id
      and revoked_at is null
      and expires_at>clock_timestamp()
    order by created_at desc,id desc
    offset 5
  );
  return new;
end;
$$;

revoke all on function public.aora_trim_subject_sessions()
from public, anon, authenticated;

drop trigger if exists aora_trim_subject_sessions_after_insert
on public.app_sessions;
create trigger aora_trim_subject_sessions_after_insert
after insert on public.app_sessions
for each row execute function public.aora_trim_subject_sessions();

create or replace function public.aora_cleanup_expired_sessions(
  p_now timestamptz default clock_timestamp()
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare deleted_count integer;
begin
  delete from public.app_sessions
  where expires_at<=p_now
     or (revoked_at is not null and revoked_at<=p_now-interval '7 days');
  get diagnostics deleted_count=row_count;
  return deleted_count;
end;
$$;

revoke all on function public.aora_cleanup_expired_sessions(timestamptz)
from public, anon, authenticated;
grant execute on function public.aora_cleanup_expired_sessions(timestamptz)
to service_role;

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname='manager-session-projection-cleanup';
    perform cron.schedule(
      'manager-session-projection-cleanup',
      '17 * * * *',
      'select public.aora_cleanup_expired_sessions();'
    );
  end if;
exception when undefined_table or invalid_schema_name then
  null;
end
$$;

