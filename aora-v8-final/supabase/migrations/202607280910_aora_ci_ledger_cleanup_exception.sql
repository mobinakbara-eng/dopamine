create or replace function public.aora_reject_time_entry_event_mutation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' and current_setting('aora.maintenance_cleanup',true)='on' then
    if coalesce(old.metadata->>'selfTest','false')='true' then
      return old;
    end if;
    if exists(
      select 1
      from public.organizations organization
      join public.workspace_snapshots snapshot on snapshot.organization_id=organization.id
      where organization.id=old.organization_id
        and organization.slug like 'aora-ci-%'
        and coalesce(snapshot.state #>> '{meta,tenantSource}','')='github-oidc-ci'
        and coalesce(snapshot.state #>> '{meta,ciRunId}','') ~ '^[0-9]+$'
    ) then
      return old;
    end if;
  end if;
  raise exception 'time_entry_events_are_immutable';
end;
$$;

create or replace function public.aora_cleanup_ci_tenant(p_slug text,p_run_id text,p_run_attempt integer)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org_id uuid;
begin
  if p_slug !~ '^aora-ci-[a-z0-9-]{6,54}$' or p_run_id !~ '^[0-9]+$' or p_run_attempt < 1 then
    raise exception 'invalid_ci_cleanup_parameters';
  end if;

  select organization.id into v_org_id
  from public.organizations organization
  join public.workspace_snapshots snapshot on snapshot.organization_id=organization.id
  where organization.slug=p_slug
    and snapshot.state #>> '{meta,tenantSource}'='github-oidc-ci'
    and snapshot.state #>> '{meta,ciRunId}'=p_run_id
    and coalesce((snapshot.state #>> '{meta,ciRunAttempt}')::integer,0)=p_run_attempt
  for update of organization;

  if v_org_id is null then return false; end if;
  perform set_config('aora.maintenance_cleanup','on',true);
  delete from public.organizations where id=v_org_id;
  return true;
end;
$$;

revoke all on function public.aora_reject_time_entry_event_mutation() from public,anon,authenticated;
grant execute on function public.aora_reject_time_entry_event_mutation() to service_role;
revoke all on function public.aora_cleanup_ci_tenant(text,text,integer) from public,anon,authenticated;
grant execute on function public.aora_cleanup_ci_tenant(text,text,integer) to service_role;
