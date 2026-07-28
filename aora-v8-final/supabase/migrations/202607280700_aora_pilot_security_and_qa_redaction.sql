revoke all on function public.aora_activate_invitation_atomic(uuid,bigint,text,text,text,text,text,text,text,integer,jsonb,text,text,integer) from public, anon, authenticated;
grant execute on function public.aora_activate_invitation_atomic(uuid,bigint,text,text,text,text,text,text,text,integer,jsonb,text,text,integer) to service_role;
revoke all on function public.aora_broadcast_workspace_revision() from public, anon, authenticated;
grant execute on function public.aora_broadcast_workspace_revision() to service_role;
revoke all on function public.aora_create_pilot_backup(uuid,text) from public, anon, authenticated;
grant execute on function public.aora_create_pilot_backup(uuid,text) to service_role;
revoke all on function public.aora_ledger_from_time_projection() from public, anon, authenticated;
grant execute on function public.aora_ledger_from_time_projection() to service_role;
revoke all on function public.aora_reject_time_entry_event_mutation() from public, anon, authenticated;
grant execute on function public.aora_reject_time_entry_event_mutation() to service_role;
revoke all on function public.aora_seal_time_entry_event() from public, anon, authenticated;
grant execute on function public.aora_seal_time_entry_event() to service_role;
revoke all on function public.aora_verify_pilot_backup(uuid) from public, anon, authenticated;
grant execute on function public.aora_verify_pilot_backup(uuid) to service_role;
revoke all on function public.aora_verify_time_entry_chain(uuid,text) from public, anon, authenticated;
grant execute on function public.aora_verify_time_entry_chain(uuid,text) to service_role;

create or replace function public.aora_redact_pilot_qa_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(new.evidence) <> 'object' then return new; end if;
  if coalesce(new.evidence #>> '{activation,data,token}','') ~ '^[0-9a-fA-F]{64}$' then
    new.evidence := jsonb_set(new.evidence,'{activation,data,token}','"[REDACTED]"'::jsonb,true);
  end if;
  if coalesce(new.evidence #>> '{login,data,token}','') ~ '^[0-9a-fA-F]{64}$' then
    new.evidence := jsonb_set(new.evidence,'{login,data,token}','"[REDACTED]"'::jsonb,true);
  end if;
  return new;
end;
$$;

drop trigger if exists aora_redact_pilot_qa_evidence_before_write on public.pilot_qa_runs;
create trigger aora_redact_pilot_qa_evidence_before_write
before insert or update of evidence on public.pilot_qa_runs
for each row execute function public.aora_redact_pilot_qa_evidence();

revoke all on function public.aora_redact_pilot_qa_evidence() from public, anon, authenticated;
grant execute on function public.aora_redact_pilot_qa_evidence() to service_role;

update public.pilot_qa_runs
set evidence = case when coalesce(evidence #>> '{activation,data,token}','') ~ '^[0-9a-fA-F]{64}$'
  then jsonb_set(evidence,'{activation,data,token}','"[REDACTED]"'::jsonb,true) else evidence end;
update public.pilot_qa_runs
set evidence = case when coalesce(evidence #>> '{login,data,token}','') ~ '^[0-9a-fA-F]{64}$'
  then jsonb_set(evidence,'{login,data,token}','"[REDACTED]"'::jsonb,true) else evidence end;
