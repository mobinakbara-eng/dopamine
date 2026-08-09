begin;

create or replace function public.aora_soft_delete_task_rule(
  p_organization_id uuid,
  p_rule_id text,
  p_actor_id text,
  p_reason text default 'Vom Manager gelöscht'
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_rule public.task_rules%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  select * into v_rule
  from public.task_rules
  where organization_id=p_organization_id and id=p_rule_id
  for update;

  if not found or v_rule.deleted_at is not null then
    raise exception using errcode='P0002',message='task_rule_not_found';
  end if;

  update public.task_rules
    set active=false,
        deleted_at=v_now,
        deleted_by=p_actor_id,
        delete_reason=coalesce(nullif(p_reason,''),'Vom Manager gelöscht'),
        updated_by=p_actor_id,
        updated_at=v_now,
        version=version+1
  where organization_id=p_organization_id and id=p_rule_id;

  return jsonb_build_object('ruleId',p_rule_id,'deleted',true);
end
$$;

revoke all on function public.aora_soft_delete_task_rule(uuid,text,text,text) from public;
grant execute on function public.aora_soft_delete_task_rule(uuid,text,text,text) to service_role;

commit;
