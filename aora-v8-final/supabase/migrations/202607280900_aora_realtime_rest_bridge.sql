drop trigger if exists aora_workspace_revision_broadcast on public.workspace_changes;

create or replace function public.aora_broadcast_session_delta(p_organization_id uuid,p_payload jsonb)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  return;
end;
$$;

create or replace function public.aora_broadcast_workspace_revision()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  return new;
end;
$$;

create or replace function public.aora_active_session_topics(p_organization_id uuid)
returns table(topic text)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select 'aora:'||encode(session.token_hash,'hex')
  from public.app_sessions session
  where session.organization_id=p_organization_id
    and session.revoked_at is null
    and session.expires_at>clock_timestamp()
  order by session.created_at;
$$;

revoke all on function public.aora_broadcast_session_delta(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.aora_broadcast_session_delta(uuid,jsonb) to service_role;
revoke all on function public.aora_broadcast_workspace_revision() from public,anon,authenticated;
grant execute on function public.aora_broadcast_workspace_revision() to service_role;
revoke all on function public.aora_active_session_topics(uuid) from public,anon,authenticated;
grant execute on function public.aora_active_session_topics(uuid) to service_role;
