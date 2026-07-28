-- Keep snapshot projection single-pass. The workspace_snapshots trigger projects
-- relational rows and then restores explicit manager/location access atomically.
create or replace function public.aora_commit_workspace_state(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_actor_role text,
  p_actor_id text,
  p_event_type text,
  p_event_payload jsonb default '{}'::jsonb,
  p_entity_type text default null,
  p_entity_id text default null,
  p_location_id text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_revision bigint := p_expected_revision + 1;
  v_now timestamptz := clock_timestamp();
  affected integer;
begin
  if p_state is null or p_event_type is null then
    raise exception 'invalid_state_commit';
  end if;

  update public.workspace_snapshots
  set state = p_state,
      revision = v_revision,
      updated_at = v_now
  where organization_id = p_organization_id
    and revision = p_expected_revision;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'revision_conflict';
  end if;

  insert into public.workspace_events(
    organization_id,
    sequence,
    actor_role,
    actor_subject_id,
    event_type,
    event_payload,
    created_at,
    request_id
  )
  values(
    p_organization_id,
    v_revision,
    coalesce(p_actor_role, 'system'),
    p_actor_id,
    p_event_type,
    coalesce(p_event_payload, '{}'::jsonb),
    v_now,
    gen_random_uuid()::text
  )
  on conflict (organization_id, sequence) do update
  set event_type = excluded.event_type,
      event_payload = excluded.event_payload,
      created_at = excluded.created_at;

  perform public.aora_record_workspace_event(
    p_organization_id,
    v_revision,
    p_event_type,
    p_entity_type,
    p_entity_id,
    p_location_id,
    p_event_payload
  );

  insert into public.workspace_changes(organization_id, revision, changed_at)
  values(p_organization_id, v_revision, v_now)
  on conflict (organization_id) do update
  set revision = excluded.revision,
      changed_at = excluded.changed_at;

  return v_revision;
end;
$function$;

revoke all on function public.aora_commit_workspace_state(
  uuid, bigint, jsonb, text, text, text, jsonb, text, text, text
) from public, anon, authenticated;

grant execute on function public.aora_commit_workspace_state(
  uuid, bigint, jsonb, text, text, text, jsonb, text, text, text
) to service_role;

