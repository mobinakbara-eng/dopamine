create or replace function public.aora_commit_kiosk_activation(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_actor_role text,
  p_actor_id text,
  p_event_type text,
  p_device_id text,
  p_device_name text,
  p_location_id text,
  p_activation_code text,
  p_event_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_revision bigint := p_expected_revision + 1;
  v_now timestamptz := clock_timestamp();
  affected integer;
begin
  if p_state is null
    or p_event_type not in ('CREATE_KIOSK_DEVICE', 'ROTATE_KIOSK_ACTIVATION')
    or p_device_id !~ '^kiosk_[0-9a-f-]{36}$'
    or length(trim(coalesce(p_device_name, ''))) < 2
    or length(trim(coalesce(p_location_id, ''))) < 1
    or p_activation_code !~ '^[0-9]{8}$'
  then
    raise exception 'invalid_kiosk_activation';
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

  insert into public.demo_identities(
    organization_id,
    role,
    subject_id,
    display_name,
    location_id,
    pin_hash,
    active
  )
  values(
    p_organization_id,
    'kiosk',
    p_device_id,
    trim(p_device_name),
    p_location_id,
    crypt(p_activation_code, gen_salt('bf')),
    true
  )
  on conflict (organization_id, role, subject_id) do update
  set display_name = excluded.display_name,
      location_id = excluded.location_id,
      pin_hash = excluded.pin_hash,
      active = true;

  update public.app_sessions
  set revoked_at = v_now
  where organization_id = p_organization_id
    and role = 'kiosk'
    and subject_id = p_device_id
    and revoked_at is null;

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
    coalesce(p_actor_role, 'admin'),
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
    'kiosk',
    p_device_id,
    p_location_id,
    coalesce(p_event_payload, '{}'::jsonb)
  );

  insert into public.workspace_changes(organization_id, revision, changed_at)
  values(p_organization_id, v_revision, v_now)
  on conflict (organization_id) do update
  set revision = excluded.revision,
      changed_at = excluded.changed_at;

  return v_revision;
end;
$function$;

revoke all on function public.aora_commit_kiosk_activation(
  uuid, bigint, jsonb, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.aora_commit_kiosk_activation(
  uuid, bigint, jsonb, text, text, text, text, text, text, text, jsonb
) to service_role;
