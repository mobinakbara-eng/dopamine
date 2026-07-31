begin;

insert into public.admins (organization_id, id, name, role, payload)
select
  ws.organization_id,
  admin_item ->> 'id',
  admin_item ->> 'name',
  coalesce(nullif(admin_item ->> 'role', ''), nullif(admin_item ->> 'scope', ''), 'manager'),
  admin_item
from public.workspace_snapshots ws
cross join lateral jsonb_array_elements(coalesce(ws.state -> 'admins', '[]'::jsonb)) admin_item
where nullif(admin_item ->> 'id', '') is not null
on conflict (organization_id, id) do update set
  name = excluded.name,
  role = excluded.role,
  payload = excluded.payload;

create or replace function public.aora_activate_invitation_atomic(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_invitation_id text,
  p_token_hash text,
  p_subject_role text,
  p_subject_id text,
  p_email text,
  p_salt text,
  p_password_hash text,
  p_iterations integer,
  p_state jsonb,
  p_session_token_hash text,
  p_session_location_id text,
  p_session_ttl_seconds integer default 43200
) returns table(next_revision bigint, session_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint := p_expected_revision + 1;
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + make_interval(secs => greatest(300, least(p_session_ttl_seconds, 86400)));
  v_admin jsonb;
  affected integer;
begin
  if p_subject_role not in ('admin', 'employee')
     or p_email is null
     or p_iterations < 210000
     or p_state is null
     or p_session_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invitation activation parameters';
  end if;

  perform 1
  from public.aora_v8_final_invitation_tokens
  where organization_id = p_organization_id
    and invitation_id = p_invitation_id
    and trim(token_hash) = lower(p_token_hash)
    and used_at is null
    and revoked_at is null
    and expires_at > v_now
  for update;
  if not found then
    raise exception 'invitation_invalid';
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

  insert into public.aora_v8_final_credentials (
    organization_id, subject_role, subject_id, email, salt, password_hash,
    iterations, active, created_at, updated_at
  ) values (
    p_organization_id, p_subject_role, p_subject_id, lower(p_email), p_salt,
    p_password_hash, p_iterations, true, v_now, v_now
  )
  on conflict (organization_id, subject_role, subject_id) do update set
    email = excluded.email,
    salt = excluded.salt,
    password_hash = excluded.password_hash,
    iterations = excluded.iterations,
    active = true,
    updated_at = v_now;

  update public.aora_v8_final_invitation_tokens
  set used_at = v_now,
      updated_at = v_now
  where organization_id = p_organization_id
    and invitation_id = p_invitation_id;

  if p_subject_role = 'admin' then
    select admin_item
    into v_admin
    from jsonb_array_elements(coalesce(p_state -> 'admins', '[]'::jsonb)) admin_item
    where admin_item ->> 'id' = p_subject_id
    limit 1;

    if v_admin is null then
      raise exception 'admin_projection_missing';
    end if;

    insert into public.admins (organization_id, id, name, role, payload)
    values (
      p_organization_id,
      p_subject_id,
      v_admin ->> 'name',
      coalesce(nullif(v_admin ->> 'role', ''), nullif(v_admin ->> 'scope', ''), 'manager'),
      v_admin
    )
    on conflict (organization_id, id) do update set
      name = excluded.name,
      role = excluded.role,
      payload = excluded.payload;

    delete from public.manager_location_access
    where organization_id = p_organization_id
      and manager_id = p_subject_id;

    if coalesce(v_admin ->> 'scope', 'manager') = 'manager' then
      insert into public.manager_location_access (
        organization_id, manager_id, location_id, created_at
      )
      select
        p_organization_id,
        p_subject_id,
        location_value,
        v_now
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_admin -> 'locationIds') = 'array' then v_admin -> 'locationIds'
          when nullif(v_admin ->> 'locationId', '') is not null then jsonb_build_array(v_admin ->> 'locationId')
          else '[]'::jsonb
        end
      ) location_value
      join public.locations location_row
        on location_row.organization_id = p_organization_id
       and location_row.id = location_value
      on conflict (organization_id, manager_id, location_id) do nothing;
    end if;
  end if;

  insert into public.app_sessions (
    organization_id, role, subject_id, location_id, token_hash,
    expires_at, last_seen_at, created_at
  ) values (
    p_organization_id, p_subject_role, p_subject_id, p_session_location_id,
    decode(p_session_token_hash, 'hex'), v_expires, v_now, v_now
  );

  insert into public.workspace_changes (organization_id, revision, changed_at)
  values (p_organization_id, v_revision, v_now)
  on conflict (organization_id) do update set
    revision = excluded.revision,
    changed_at = excluded.changed_at;

  next_revision := v_revision;
  session_expires_at := v_expires;
  return next;
end;
$$;

revoke all on function public.aora_activate_invitation_atomic(uuid,bigint,text,text,text,text,text,text,text,integer,jsonb,text,text,integer) from public, anon, authenticated;
grant execute on function public.aora_activate_invitation_atomic(uuid,bigint,text,text,text,text,text,text,text,integer,jsonb,text,text,integer) to service_role;

commit;
