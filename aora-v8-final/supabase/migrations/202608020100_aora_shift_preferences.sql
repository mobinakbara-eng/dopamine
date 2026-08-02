-- Employee-proposed shifts, kept outside the legacy workspace JSON so role and
-- location scoping remain explicit. Only the service role may access the table.
create table if not exists public.aora_shift_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id text not null,
  location_id text not null,
  preference_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 180),
  note text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  decision_reason text,
  decided_by text,
  decided_at timestamptz,
  resulting_shift_id text,
  version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint aora_shift_preferences_time_order check (end_time > start_time),
  constraint aora_shift_preferences_note_length check (char_length(coalesce(note,'')) <= 240),
  constraint aora_shift_preferences_reason_length check (char_length(coalesce(decision_reason,'')) <= 240)
);

create index if not exists aora_shift_preferences_org_employee_date_idx
  on public.aora_shift_preferences(organization_id, employee_id, preference_date desc);
create index if not exists aora_shift_preferences_org_location_status_date_idx
  on public.aora_shift_preferences(organization_id, location_id, status, preference_date);
create unique index if not exists aora_shift_preferences_unique_pending_slot_idx
  on public.aora_shift_preferences(organization_id, employee_id, preference_date, start_time, end_time)
  where status = 'pending';

alter table public.aora_shift_preferences enable row level security;
revoke all on table public.aora_shift_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.aora_shift_preferences to service_role;

create or replace function public.aora_decide_shift_preference(
  p_organization_id uuid,
  p_preference_id uuid,
  p_expected_revision bigint,
  p_decision text,
  p_actor_role text,
  p_actor_id text,
  p_actor_name text,
  p_reason text default null,
  p_shift jsonb default null
)
returns table(revision bigint, resulting_shift_id text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_preference public.aora_shift_preferences%rowtype;
  v_snapshot public.workspace_snapshots%rowtype;
  v_state jsonb;
  v_now timestamptz := clock_timestamp();
  v_revision bigint;
  v_shift_id text := null;
  v_shift jsonb := null;
  v_employee_name text := 'Mitarbeiter';
  v_notification jsonb;
  v_audit jsonb;
  v_overlap boolean := false;
begin
  if p_decision not in ('accepted','rejected') then
    raise exception 'invalid_shift_preference_decision';
  end if;
  if p_actor_role not in ('owner','manager') or nullif(p_actor_id,'') is null then
    raise exception 'shift_preference_admin_required';
  end if;

  select * into v_preference
  from public.aora_shift_preferences
  where id = p_preference_id
    and organization_id = p_organization_id
  for update;

  if not found then raise exception 'shift_preference_not_found'; end if;
  if v_preference.status <> 'pending' then raise exception 'shift_preference_already_decided'; end if;

  select * into v_snapshot
  from public.workspace_snapshots
  where organization_id = p_organization_id
  for update;

  if not found then raise exception 'workspace_snapshot_not_found'; end if;
  if v_snapshot.revision <> p_expected_revision then raise exception 'revision_conflict'; end if;

  v_state := coalesce(v_snapshot.state, '{}'::jsonb);
  select coalesce(item->>'name','Mitarbeiter') into v_employee_name
  from jsonb_array_elements(coalesce(v_state->'employees','[]'::jsonb)) item
  where item->>'id' = v_preference.employee_id
  limit 1;

  if p_decision = 'accepted' then
    if p_shift is null then raise exception 'accepted_shift_payload_required'; end if;
    if coalesce(p_shift->>'employeeId','') <> v_preference.employee_id
      or coalesce(p_shift->>'locationId','') <> v_preference.location_id
      or coalesce(p_shift->>'date','') <> v_preference.preference_date::text
      or coalesce(p_shift->>'start','') = ''
      or coalesce(p_shift->>'end','') = '' then
      raise exception 'accepted_shift_payload_mismatch';
    end if;
    if (p_shift->>'end')::time <= (p_shift->>'start')::time then
      raise exception 'accepted_shift_time_order';
    end if;

    select exists(
      select 1
      from jsonb_array_elements(coalesce(v_state->'shifts','[]'::jsonb)) existing
      where existing->>'employeeId' = v_preference.employee_id
        and existing->>'date' = v_preference.preference_date::text
        and coalesce(existing->>'status','') <> 'cancelled'
        and (p_shift->>'start')::time < (existing->>'end')::time
        and (p_shift->>'end')::time > (existing->>'start')::time
    ) into v_overlap;
    if v_overlap then raise exception 'shift_overlap'; end if;

    v_shift_id := 'shift_' || gen_random_uuid()::text;
    v_shift := p_shift || jsonb_build_object(
      'id', v_shift_id,
      'employeeId', v_preference.employee_id,
      'locationId', v_preference.location_id,
      'date', v_preference.preference_date::text,
      'status', coalesce(nullif(p_shift->>'status',''),'draft'),
      'source', 'employee_preference',
      'sourcePreferenceId', v_preference.id::text,
      'version', 1,
      'publishedAt', null,
      'createdAt', v_now,
      'createdBy', p_actor_id
    );
    v_state := jsonb_set(
      v_state,
      '{shifts}',
      coalesce(v_state->'shifts','[]'::jsonb) || jsonb_build_array(v_shift),
      true
    );
  end if;

  v_notification := jsonb_build_object(
    'id', 'note_' || gen_random_uuid()::text,
    'key', 'shift-preference:' || v_preference.id::text || ':' || p_decision,
    'employeeId', v_preference.employee_id,
    'locationId', v_preference.location_id,
    'title', case when p_decision = 'accepted' then 'Schichtwunsch übernommen' else 'Schichtwunsch abgelehnt' end,
    'body', v_preference.preference_date::text || ' · ' || to_char(v_preference.start_time,'HH24:MI') || '–' || to_char(v_preference.end_time,'HH24:MI') || case when nullif(trim(coalesce(p_reason,'')),'') is not null then ' · ' || trim(p_reason) else '' end,
    'tone', case when p_decision = 'accepted' then 'success' else 'warning' end,
    'read', false,
    'createdAt', v_now
  );
  v_state := jsonb_set(v_state, '{notifications}', jsonb_build_array(v_notification) || coalesce(v_state->'notifications','[]'::jsonb), true);

  v_audit := jsonb_build_object(
    'id', 'audit_' || gen_random_uuid()::text,
    'action', 'shift_preference.' || p_decision,
    'actor', coalesce(nullif(p_actor_name,''),p_actor_id),
    'entity', 'shift_preference',
    'entityId', v_preference.id::text,
    'detail', v_employee_name || ' · ' || v_preference.preference_date::text || ' · ' || to_char(v_preference.start_time,'HH24:MI') || '–' || to_char(v_preference.end_time,'HH24:MI'),
    'metadata', jsonb_build_object('locationId',v_preference.location_id,'employeeId',v_preference.employee_id,'resultingShiftId',v_shift_id),
    'createdAt', v_now
  );
  v_state := jsonb_set(v_state, '{audit}', jsonb_build_array(v_audit) || coalesce(v_state->'audit','[]'::jsonb), true);

  update public.aora_shift_preferences
  set status = p_decision,
      decision_reason = nullif(trim(coalesce(p_reason,'')),''),
      decided_by = p_actor_id,
      decided_at = v_now,
      resulting_shift_id = v_shift_id,
      version = version + 1,
      updated_at = v_now
  where id = v_preference.id;

  v_revision := p_expected_revision + 1;
  v_state := jsonb_set(
    v_state,
    '{meta}',
    coalesce(v_state->'meta','{}'::jsonb) || jsonb_build_object('revision',v_revision,'updatedAt',v_now),
    true
  );

  update public.workspace_snapshots as ws
  set state = v_state,
      revision = v_revision,
      updated_at = v_now
  where ws.organization_id = p_organization_id
    and ws.revision = p_expected_revision;
  if not found then raise exception 'revision_conflict'; end if;

  insert into public.workspace_events(
    organization_id, sequence, actor_role, actor_subject_id, event_type, event_payload, created_at, request_id
  ) values (
    p_organization_id, v_revision, p_actor_role, p_actor_id,
    'DECIDE_SHIFT_PREFERENCE',
    jsonb_build_object('preferenceId',v_preference.id,'decision',p_decision,'resultingShiftId',v_shift_id,'locationId',v_preference.location_id),
    v_now, gen_random_uuid()::text
  ) on conflict (organization_id, sequence) do update
    set event_type = excluded.event_type,
        event_payload = excluded.event_payload,
        created_at = excluded.created_at;

  perform public.aora_record_workspace_event(
    p_organization_id,
    v_revision,
    'DECIDE_SHIFT_PREFERENCE',
    'shift_preference',
    v_preference.id::text,
    v_preference.location_id,
    jsonb_build_object('decision',p_decision,'resultingShiftId',v_shift_id,'employeeId',v_preference.employee_id)
  );

  insert into public.workspace_changes(organization_id, revision, changed_at)
  values (p_organization_id, v_revision, v_now)
  on conflict (organization_id) do update
    set revision = excluded.revision,
        changed_at = excluded.changed_at;

  return query select v_revision, v_shift_id;
end;
$function$;

revoke all on function public.aora_decide_shift_preference(uuid,uuid,bigint,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.aora_decide_shift_preference(uuid,uuid,bigint,text,text,text,text,text,jsonb)
  to service_role;
