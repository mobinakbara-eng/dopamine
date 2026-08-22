begin;

create or replace function public.aora_reject_evidence_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  raise exception using errcode='55000',message=TG_TABLE_NAME||'_is_immutable';
end $$;

drop trigger if exists inventory_product_creation_requests_immutable on public.inventory_product_creation_requests;
create trigger inventory_product_creation_requests_immutable
before update or delete on public.inventory_product_creation_requests
for each row execute function public.aora_reject_evidence_mutation();

drop trigger if exists datev_hours_export_runs_immutable on public.datev_hours_export_runs;
create trigger datev_hours_export_runs_immutable
before update or delete on public.datev_hours_export_runs
for each row execute function public.aora_reject_evidence_mutation();

drop trigger if exists datev_hours_config_audit_immutable on public.datev_hours_config_audit;
create trigger datev_hours_config_audit_immutable
before update or delete on public.datev_hours_config_audit
for each row execute function public.aora_reject_evidence_mutation();

revoke all on function public.aora_reject_evidence_mutation() from public,anon,authenticated;
grant execute on function public.aora_reject_evidence_mutation() to service_role;

commit;
