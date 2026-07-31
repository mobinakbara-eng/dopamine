begin;

create extension if not exists pg_cron with schema pg_catalog;

alter table public.task_generation_keys add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
  if exists(select 1 from pg_constraint where conrelid='public.task_generation_keys'::regclass and conname='task_generation_keys_pkey') then
    alter table public.task_generation_keys drop constraint task_generation_keys_pkey;
  end if;
end $$;
alter table public.task_generation_keys alter column employee_id drop not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.task_generation_keys'::regclass and conname='task_generation_keys_id_pkey') then
    alter table public.task_generation_keys add constraint task_generation_keys_id_pkey primary key(id);
  end if;
end $$;
create unique index if not exists task_generation_keys_dedupe_idx
  on public.task_generation_keys(organization_id,rule_id,scheduled_for,employee_id) nulls not distinct;

create table if not exists public.task_claims(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_instance_id text not null,
  employee_id text not null,
  idempotency_key uuid not null,
  claimed_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  status text not null default 'claimed' check(status in ('claimed','withdrawn','completed')),
  unique(organization_id,task_instance_id),
  unique(organization_id,idempotency_key),
  foreign key(organization_id,task_instance_id) references public.task_instances(organization_id,id) on delete cascade,
  foreign key(organization_id,employee_id) references public.employees(organization_id,id) on delete cascade
);
alter table public.task_claims enable row level security;
revoke all on public.task_claims from anon,authenticated;
grant all on public.task_claims to service_role;
drop policy if exists edge_only_deny_direct on public.task_claims;
create policy edge_only_deny_direct on public.task_claims for all to anon,authenticated using(false) with check(false);

create or replace function public.aora_claim_task_atomic(
  p_token text,
  p_task_instance_id text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_session record;
  v_task public.task_instances%rowtype;
  v_rule public.task_rules%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  if p_idempotency_key is null then raise exception using errcode='22023',message='Idempotency-Key fehlt.'; end if;
  select * into v_session from public.validate_demo_session(p_token) limit 1;
  if v_session.organization_id is null or v_session.role<>'employee' then raise exception using errcode='42501',message='Nur Mitarbeiter dürfen Aufgaben übernehmen.'; end if;
  select response into v_existing from public.idempotency_records where organization_id=v_session.organization_id and action='task_claim' and actor_id=v_session.subject_id and idempotency_key=p_idempotency_key and status='completed';
  if found then return v_existing; end if;
  insert into public.idempotency_records(organization_id,action,actor_id,idempotency_key) values(v_session.organization_id,'task_claim',v_session.subject_id,p_idempotency_key) on conflict do nothing;
  select * into v_task from public.task_instances where organization_id=v_session.organization_id and id=p_task_instance_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Aufgabe wurde nicht gefunden.'; end if;
  if v_task.status not in ('open','in_progress') then raise exception using errcode='40001',message='Aufgabe ist nicht mehr verfügbar.'; end if;
  if not exists(select 1 from public.employee_location_access where organization_id=v_session.organization_id and employee_id=v_session.subject_id and location_id=v_task.location_id)
     and not exists(select 1 from public.employees where organization_id=v_session.organization_id and id=v_session.subject_id and coalesce(primary_location_id,location_id)=v_task.location_id and active and deleted_at is null) then
    raise exception using errcode='42501',message='Kein Zugriff auf diesen Standort.';
  end if;
  if v_task.rule_id is not null then
    select * into v_rule from public.task_rules where organization_id=v_session.organization_id and id=v_task.rule_id;
    if found and v_rule.assignment_strategy<>'first_claim' then raise exception using errcode='42501',message='Diese Aufgabe kann nicht frei übernommen werden.'; end if;
  end if;
  if exists(select 1 from public.task_assignments where organization_id=v_session.organization_id and task_instance_id=v_task.id) then raise exception using errcode='40001',message='Aufgabe wurde bereits übernommen.'; end if;
  insert into public.task_claims(organization_id,task_instance_id,employee_id,idempotency_key) values(v_session.organization_id,v_task.id,v_session.subject_id,p_idempotency_key);
  insert into public.task_assignments(organization_id,task_instance_id,employee_id,assigned_at,accepted_at,status) values(v_session.organization_id,v_task.id,v_session.subject_id,now(),now(),'accepted');
  update public.task_instances set status='in_progress',version=version+1,updated_at=now() where organization_id=v_session.organization_id and id=v_task.id;
  insert into public.audit_logs(organization_id,id,location_id,action,actor,actor_type,actor_id,entity,entity_type,entity_id,created_at,payload,metadata)
  values(v_session.organization_id,'audit_'||replace(gen_random_uuid()::text,'-',''),v_task.location_id,'TASK_CLAIMED',v_session.subject_id,'employee',v_session.subject_id,'task_instance','task_instance',v_task.id,now(),jsonb_build_object('employeeId',v_session.subject_id),jsonb_build_object('idempotencyKey',p_idempotency_key));
  v_response=jsonb_build_object('taskId',v_task.id,'employeeId',v_session.subject_id,'status','in_progress','serverTime',now());
  update public.idempotency_records set status='completed',response=v_response,updated_at=now() where organization_id=v_session.organization_id and action='task_claim' and actor_id=v_session.subject_id and idempotency_key=p_idempotency_key;
  return v_response;
exception when others then
  update public.idempotency_records set status='failed',error=sqlerrm,updated_at=now() where organization_id=coalesce(v_session.organization_id,'00000000-0000-0000-0000-000000000000') and action='task_claim' and actor_id=coalesce(v_session.subject_id,'unknown') and idempotency_key=p_idempotency_key;
  raise;
end $$;
revoke all on function public.aora_claim_task_atomic(text,text,uuid) from public,anon,authenticated;
grant execute on function public.aora_claim_task_atomic(text,text,uuid) to service_role;

create or replace function public.aora_get_runtime_secret(p_name text)
returns text
language sql
security definer
set search_path=vault,public,pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets where name=p_name order by created_at desc limit 1;
$$;
revoke all on function public.aora_get_runtime_secret(text) from public,anon,authenticated;
grant execute on function public.aora_get_runtime_secret(text) to service_role;

create or replace function public.aora_invoke_edge_job(p_function_name text,p_secret_name text)
returns bigint
language plpgsql
security definer
set search_path=public,vault,net,pg_temp
as $$
declare
  v_base_url text;
  v_secret text;
  v_request_id bigint;
begin
  select public.aora_get_runtime_secret('aora_edge_base_url') into v_base_url;
  select public.aora_get_runtime_secret(p_secret_name) into v_secret;
  if nullif(v_base_url,'') is null or nullif(v_secret,'') is null then
    insert into public.scheduler_runs(job_type,scheduled_for,status,error_count,details,completed_at)
    values(p_function_name,date_trunc('minute',now()),'failed',1,jsonb_build_object('reason','runtime_secret_missing'),now())
    on conflict(job_type,scheduled_for,organization_id) do nothing;
    return null;
  end if;
  select net.http_post(
    url:=rtrim(v_base_url,'/')||'/functions/v1/'||p_function_name,
    headers:=jsonb_build_object('Content-Type','application/json','X-Aora-Job-Token',v_secret),
    body:=jsonb_build_object('scheduled_for',now())
  ) into v_request_id;
  return v_request_id;
end $$;
revoke all on function public.aora_invoke_edge_job(text,text) from public,anon,authenticated;
grant execute on function public.aora_invoke_edge_job(text,text) to service_role,postgres;

-- Jobs are recreated idempotently. They become effective after Vault secrets are provisioned.
do $$ declare v_id bigint; begin
  select jobid into v_id from cron.job where jobname='aora-task-scheduler'; if v_id is not null then perform cron.unschedule(v_id); end if;
  select jobid into v_id from cron.job where jobname='aora-push-dispatch'; if v_id is not null then perform cron.unschedule(v_id); end if;
  select jobid into v_id from cron.job where jobname='aora-idempotency-cleanup'; if v_id is not null then perform cron.unschedule(v_id); end if;
end $$;
select cron.schedule('aora-task-scheduler','*/5 * * * *',$$select public.aora_invoke_edge_job('aora-v8-task-scheduler','aora_scheduler_token');$$);
select cron.schedule('aora-push-dispatch','* * * * *',$$select public.aora_invoke_edge_job('aora-v8-push-dispatch','aora_push_dispatch_token');$$);
select cron.schedule('aora-idempotency-cleanup','17 3 * * *',$$delete from public.idempotency_records where expires_at<now();$$);

commit;
