create or replace function public.aora_hardening_project_snapshot_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.organizations organization
    where organization.id = new.organization_id
      and organization.slug = 'aora-v8-hardening-demo'
      and organization.status = 'active'
  ) then
    perform public.project_workspace_state(new.organization_id, new.state);
  end if;

  return new;
end;
$$;

revoke all on function public.aora_hardening_project_snapshot_trigger()
from public, anon, authenticated;

grant execute on function public.aora_hardening_project_snapshot_trigger()
to service_role;

drop trigger if exists aora_hardening_project_snapshot_after_update
on public.workspace_snapshots;

create trigger aora_hardening_project_snapshot_after_update
after update of state on public.workspace_snapshots
for each row
when (new.state is distinct from old.state)
execute function public.aora_hardening_project_snapshot_trigger();
