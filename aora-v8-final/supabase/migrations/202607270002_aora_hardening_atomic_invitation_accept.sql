create or replace function public.aora_accept_invitation_atomic(
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
  p_state jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_revision bigint := p_expected_revision + 1;
  changed_at timestamptz := clock_timestamp();
  affected integer;
begin
  if p_subject_role not in ('admin','employee')
     or p_email is null
     or p_iterations < 210000
     or p_state is null then
    raise exception 'invalid invitation acceptance parameters';
  end if;

  perform 1
  from public.aora_v8_final_invitation_tokens
  where organization_id = p_organization_id
    and invitation_id = p_invitation_id
    and trim(token_hash) = lower(p_token_hash)
    and used_at is null
    and revoked_at is null
    and expires_at > changed_at
  for update;

  if not found then
    raise exception 'invitation_invalid';
  end if;

  update public.workspace_snapshots
  set state = p_state,
      revision = next_revision,
      updated_at = changed_at
  where organization_id = p_organization_id
    and revision = p_expected_revision;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'revision_conflict';
  end if;

  insert into public.aora_v8_final_credentials (
    organization_id, subject_role, subject_id, email, salt,
    password_hash, iterations, active, created_at, updated_at
  ) values (
    p_organization_id, p_subject_role, p_subject_id, lower(p_email), p_salt,
    p_password_hash, p_iterations, true, changed_at, changed_at
  )
  on conflict (organization_id, subject_role, subject_id) do update
  set email = excluded.email,
      salt = excluded.salt,
      password_hash = excluded.password_hash,
      iterations = excluded.iterations,
      active = true,
      updated_at = changed_at;

  update public.aora_v8_final_invitation_tokens
  set used_at = changed_at,
      updated_at = changed_at
  where organization_id = p_organization_id
    and invitation_id = p_invitation_id;

  perform public.project_workspace_state(p_organization_id, p_state);

  insert into public.workspace_changes (organization_id, revision, changed_at)
  values (p_organization_id, next_revision, changed_at)
  on conflict (organization_id) do update
  set revision = excluded.revision,
      changed_at = excluded.changed_at;

  return next_revision;
end;
$$;

revoke all on function public.aora_accept_invitation_atomic(
  uuid,bigint,text,text,text,text,text,text,text,integer,jsonb
) from public, anon, authenticated;
grant execute on function public.aora_accept_invitation_atomic(
  uuid,bigint,text,text,text,text,text,text,text,integer,jsonb
) to service_role;
