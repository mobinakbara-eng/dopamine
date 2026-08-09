begin;

create or replace function public.aora_clockout_gate(
  p_token text,
  p_employee_id text,
  p_location_id text,
  p_shift_id text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_session record;
  v_count integer;
  v_tasks jsonb;
  v_scope text;
begin
  select * into v_session from public.validate_demo_session(p_token) limit 1;
  if v_session.organization_id is null then
    raise exception using errcode='28000',message='Sitzung ist ungültig oder abgelaufen.';
  end if;

  if v_session.role='employee' and v_session.subject_id<>p_employee_id then
    raise exception using errcode='42501',message='Kein Zugriff auf diesen Mitarbeiter.';
  end if;

  if v_session.role='kiosk' and v_session.location_id<>p_location_id then
    raise exception using errcode='42501',message='Kiosk gehört zu einem anderen Standort.';
  end if;

  if v_session.role='admin' then
    select coalesce(payload->>'scope','manager') into v_scope
    from public.admins
    where organization_id=v_session.organization_id and id=v_session.subject_id;

    if coalesce(v_scope,'manager')<>'owner' and not exists(
      select 1 from public.manager_location_access
      where organization_id=v_session.organization_id
        and manager_id=v_session.subject_id
        and location_id=p_location_id
    ) then
      raise exception using errcode='42501',message='Kein Zugriff auf diesen Standort.';
    end if;
  end if;

  select
    count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',i.id,
          'title',coalesce(nullif(i.payload->>'title',''),t.title),
          'status',i.status,
          'dueAt',i.due_at,
          'policy',coalesce(r.clockout_policy,t.clockout_policy),
          'shared',coalesce(i.payload->>'completionMode','')='ANY_ASSIGNEE'
        )
        order by i.due_at nulls last
      ),
      '[]'::jsonb
    )
  into v_count,v_tasks
  from public.task_instances i
  join public.task_assignments a
    on a.organization_id=i.organization_id
   and a.task_instance_id=i.id
  join public.task_templates t
    on t.organization_id=i.organization_id
   and t.id=i.template_id
  left join public.task_rules r
    on r.organization_id=i.organization_id
   and r.id=i.rule_id
  where i.organization_id=v_session.organization_id
    and i.location_id=p_location_id
    and a.employee_id=p_employee_id
    and a.status<>'cancelled'
    and i.deleted_at is null
    and i.status not in ('completed','waived','cancelled')
    and i.blocking_clockout
    and (i.scheduled_for is null or i.scheduled_for<=now())
    and (p_shift_id is null or i.shift_id is null or i.shift_id=p_shift_id);

  return jsonb_build_object(
    'allowed',v_count=0,
    'blockingCount',v_count,
    'tasks',v_tasks,
    'serverTime',now()
  );
end $$;

revoke all on function public.aora_clockout_gate(text,text,text,text) from public,anon,authenticated;
grant execute on function public.aora_clockout_gate(text,text,text,text) to service_role;

commit;