begin;

create or replace function public.aora_prepare_restore_verification_cleanup()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if old.slug~'^aora-restore-[0-9a-f]{32}$'
     and exists(
       select 1
       from public.backup_restore_verification_runs run
       where run.restore_organization_id=old.id
         and run.status in ('running','verified','failed')
     ) then
    perform set_config('aora.maintenance_cleanup','on',true);
    perform set_config('aora.cleanup_organization_id',old.id::text,true);
  end if;
  return old;
end;
$$;

revoke all on function public.aora_prepare_restore_verification_cleanup() from public,anon,authenticated;
grant execute on function public.aora_prepare_restore_verification_cleanup() to service_role;

drop trigger if exists aora_prepare_restore_verification_cleanup_trigger on public.organizations;
create trigger aora_prepare_restore_verification_cleanup_trigger
before delete on public.organizations
for each row execute function public.aora_prepare_restore_verification_cleanup();

comment on function public.aora_prepare_restore_verification_cleanup()
is 'Allows immutable ledger rows to cascade-delete only for a random restore-verification tenant that is referenced by a recorded backup/restore run.';

commit;
