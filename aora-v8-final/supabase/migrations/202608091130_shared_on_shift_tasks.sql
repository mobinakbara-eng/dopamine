begin;

alter table public.task_rules
  drop constraint if exists task_rules_assignment_strategy_check;

alter table public.task_rules
  add constraint task_rules_assignment_strategy_check
  check (assignment_strategy in (
    'all_on_shift',
    'one_on_shift',
    'shift_leader',
    'specific_employee',
    'specific_role',
    'first_claim',
    'round_robin',
    'shared_on_shift'
  ));

create or replace function public.aora_create_shared_scheduled_task_atomic(
  p_organization_id uuid,
  p_rule_id text,
  p_template_id text,
  p_template_version integer,
  p_location_id text,
  p_shift_id text,
  p_employee_ids text[],
  p_scheduled_for timestamptz,
  p_due_at timestamptz,
  p_instance_date date,
  p_blocking_clockout boolean,
  p_title text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_key_id uuid;
  v_task_id text;
  v_existing_task_id text;
  v_employee_id text;
  v_notification_id text;
  v_notification_key text;
  v_now timestamptz:=clock_timestamp();
  v_assignment_count integer:=0;
  v_notification_count integer:=0;
begin
  if p_organization_id is null
     or nullif(p_rule_id,'') is null
     or nullif(p_template_id,'') is null
     or nullif(p_location_id,'') is null
     or p_scheduled_for is null
     or p_due_at is null
     or p_instance_date is null then
    raise exception using errcode='22023',message='Shared scheduled task input is incomplete.';
  end if;

  if coalesce(cardinality(p_employee_ids),0)=0 then
    raise exception using errcode='22023',message='Shared scheduled task requires at least one assignee.';
  end if;

  insert into public.task_generation_keys(
    organization_id,rule_id,scheduled_for,employee_id,task_instance_id
  ) values(
    p_organization_id,p_rule_id,p_scheduled_for,null,null
  )
  on conflict(organization_id,rule_id,scheduled_for,employee_id) do nothing
  returning id into v_key_id;

  if v_key_id is null then
    select task_instance_id into v_existing_task_id
    from public.task_generation_keys
    where organization_id=p_organization_id
      and rule_id=p_rule_id
      and scheduled_for=p_scheduled_for
      and employee_id is null;

    return jsonb_build_object(
      'created',false,
      'idempotent',true,
      'taskId',v_existing_task_id,
      'assignmentCount',0,
      'notificationCount',0
    );
  end if;

  v_task_id='task_'||replace(gen_random_uuid()::text,'-','');

  insert into public.task_instances(
    organization_id,id,template_id,template_version,rule_id,location_id,shift_id,
    instance_date,scheduled_for,due_at,status,blocking_clockout,version,payload,
    created_at,updated_at
  ) values(
    p_organization_id,
    v_task_id,
    p_template_id,
    greatest(coalesce(p_template_version,1),1),
    p_rule_id,
    p_location_id,
    p_shift_id,
    p_instance_date,
    p_scheduled_for,
    p_due_at,
    'open',
    coalesce(p_blocking_clockout,false),
    1,
    coalesce(p_payload,'{}'::jsonb) || jsonb_build_object(
      'completionMode','ANY_ASSIGNEE',
      'assignmentStrategy','shared_on_shift',
      'sharedAssigneeCount',cardinality(p_employee_ids)
    ),
    v_now,
    v_now
  );

  for v_employee_id in
    select distinct value
    from unnest(p_employee_ids) as value
    where nullif(value,'') is not null
  loop
    if not exists(
      select 1
      from public.employees employee
      where employee.organization_id=p_organization_id
        and employee.id=v_employee_id
        and employee.active=true
        and employee.deleted_at is null
        and (
          employee.location_id=p_location_id
          or employee.primary_location_id=p_location_id
          or exists(
            select 1
            from public.employee_location_access access
            where access.organization_id=p_organization_id
              and access.employee_id=v_employee_id
              and access.location_id=p_location_id
          )
        )
    ) then
      raise exception using errcode='42501',message='Shared task assignee is not active for this location.';
    end if;

    insert into public.task_assignments(
      organization_id,task_instance_id,employee_id,assigned_at,status
    ) values(
      p_organization_id,v_task_id,v_employee_id,v_now,'assigned'
    );
    v_assignment_count:=v_assignment_count+1;

    v_notification_id='note_'||replace(gen_random_uuid()::text,'-','');
    v_notification_key='task-shared:'||v_task_id||':employee:'||v_employee_id;

    insert into public.notifications(
      organization_id,id,employee_id,location_id,type,title,body,
      related_entity_type,related_entity_id,read,created_at,payload,idempotency_key
    ) values(
      p_organization_id,
      v_notification_id,
      v_employee_id,
      p_location_id,
      'task_assigned',
      coalesce(nullif(p_title,''),'Gemeinsame Schichtaufgabe'),
      'Gemeinsame Schichtaufgabe · eine Person kann sie für das Team erledigen · fällig bis '
        ||to_char(p_due_at at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI'),
      'task',
      v_task_id,
      false,
      v_now,
      jsonb_build_object(
        'taskId',v_task_id,
        'dueAt',p_due_at,
        'shared',true,
        'completionMode','ANY_ASSIGNEE'
      ),
      v_notification_key
    )
    on conflict(organization_id,idempotency_key)
      where idempotency_key is not null do nothing;

    select id into v_notification_id
    from public.notifications
    where organization_id=p_organization_id
      and idempotency_key=v_notification_key;

    if v_notification_id is not null then
      insert into public.notification_deliveries(
        organization_id,notification_id,channel,status,attempts,idempotency_key,
        sent_at,delivered_at,next_attempt_at
      ) values
        (
          p_organization_id,v_notification_id,'in_app','delivered',1,
          v_notification_key||':in_app',v_now,v_now,null
        ),
        (
          p_organization_id,v_notification_id,'web_push','pending',0,
          v_notification_key||':web_push',null,null,v_now
        )
      on conflict(organization_id,idempotency_key) do nothing;
      v_notification_count:=v_notification_count+1;
    end if;
  end loop;

  if v_assignment_count=0 then
    raise exception using errcode='22023',message='Shared scheduled task has no valid assignees.';
  end if;

  update public.task_generation_keys
  set task_instance_id=v_task_id
  where id=v_key_id;

  return jsonb_build_object(
    'created',true,
    'idempotent',false,
    'taskId',v_task_id,
    'assignmentCount',v_assignment_count,
    'notificationCount',v_notification_count
  );
end $$;

revoke all on function public.aora_create_shared_scheduled_task_atomic(
  uuid,text,text,integer,text,text,text[],timestamptz,timestamptz,date,boolean,text,jsonb
) from public,anon,authenticated;
grant execute on function public.aora_create_shared_scheduled_task_atomic(
  uuid,text,text,integer,text,text,text[],timestamptz,timestamptz,date,boolean,text,jsonb
) to service_role;

create or replace function public.aora_update_task_assignment_progress(
  p_organization_id uuid,
  p_task_instance_id text,
  p_employee_id text,
  p_assignment_status text,
  p_review_required boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_task public.task_instances%rowtype;
  v_assignment_count integer;
  v_remaining_count integer;
  v_instance_status text;
  v_affected integer;
  v_cancelled integer:=0;
  v_completion_mode text;
begin
  if nullif(p_task_instance_id,'') is null
     or nullif(p_employee_id,'') is null
     or p_assignment_status not in ('in_progress','completed') then
    raise exception 'invalid_task_assignment_progress';
  end if;

  select * into v_task
  from public.task_instances instance
  where instance.organization_id=p_organization_id
    and instance.id=p_task_instance_id
    and instance.deleted_at is null
  for update;

  if not found then raise exception 'task_instance_not_found'; end if;

  v_completion_mode:=coalesce(v_task.payload->>'completionMode','ALL_ASSIGNEES');

  if v_completion_mode='ANY_ASSIGNEE' then
    if v_task.status in ('completed','submitted','waived','cancelled') then
      return jsonb_build_object(
        'status',v_task.status,
        'version',v_task.version,
        'shared',true,
        'completedBy',v_task.payload->>'completedBy'
      );
    end if;

    update public.task_assignments assignment
    set status=p_assignment_status,
        accepted_at=coalesce(assignment.accepted_at,v_now),
        completed_at=case when p_assignment_status='completed' then v_now else null end
    where assignment.organization_id=p_organization_id
      and assignment.task_instance_id=p_task_instance_id
      and assignment.employee_id=p_employee_id
      and assignment.status<>'cancelled';
    get diagnostics v_affected=row_count;

    if v_affected<>1 then raise exception 'task_assignment_not_found'; end if;

    if p_assignment_status='completed' then
      update public.task_assignments assignment
      set status='cancelled'
      where assignment.organization_id=p_organization_id
        and assignment.task_instance_id=p_task_instance_id
        and assignment.employee_id<>p_employee_id
        and assignment.status not in ('completed','cancelled');
      get diagnostics v_cancelled=row_count;

      v_instance_status:=case
        when coalesce(p_review_required,false) then 'submitted'
        else 'completed'
      end;

      update public.task_instances
      set status=v_instance_status,
          completed_at=case
            when v_instance_status='completed' then coalesce(completed_at,v_now)
            else null
          end,
          version=v_task.version+1,
          updated_at=v_now,
          payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
            'completedBy',p_employee_id,
            'sharedCompletedAt',v_now
          )
      where organization_id=p_organization_id
        and id=p_task_instance_id;

      return jsonb_build_object(
        'status',v_instance_status,
        'version',v_task.version+1,
        'shared',true,
        'completedBy',p_employee_id,
        'cancelledAssignments',v_cancelled
      );
    end if;

    update public.task_instances
    set status='in_progress',
        completed_at=null,
        version=v_task.version+1,
        updated_at=v_now
    where organization_id=p_organization_id
      and id=p_task_instance_id;

    return jsonb_build_object(
      'status','in_progress',
      'version',v_task.version+1,
      'shared',true
    );
  end if;

  update public.task_assignments assignment
  set status=p_assignment_status,
      accepted_at=coalesce(assignment.accepted_at,v_now),
      completed_at=case when p_assignment_status='completed' then v_now else null end
  where assignment.organization_id=p_organization_id
    and assignment.task_instance_id=p_task_instance_id
    and assignment.employee_id=p_employee_id
    and assignment.status<>'cancelled';
  get diagnostics v_affected=row_count;

  if v_affected<>1 then raise exception 'task_assignment_not_found'; end if;

  select count(*),count(*) filter(where assignment.status<>'completed')
  into v_assignment_count,v_remaining_count
  from public.task_assignments assignment
  where assignment.organization_id=p_organization_id
    and assignment.task_instance_id=p_task_instance_id
    and assignment.status<>'cancelled';

  if v_assignment_count=0 then raise exception 'task_assignment_not_found'; end if;

  v_instance_status:=case
    when v_remaining_count>0 then 'in_progress'
    when coalesce(p_review_required,false) then 'submitted'
    else 'completed'
  end;

  update public.task_instances
  set status=v_instance_status,
      completed_at=case
        when v_instance_status='completed' then coalesce(completed_at,v_now)
        else null
      end,
      version=v_task.version+1,
      updated_at=v_now
  where organization_id=p_organization_id
    and id=p_task_instance_id;

  return jsonb_build_object(
    'status',v_instance_status,
    'version',v_task.version+1,
    'shared',false
  );
end;
$function$;

revoke all on function public.aora_update_task_assignment_progress(uuid,text,text,text,boolean)
from public,anon,authenticated;
grant execute on function public.aora_update_task_assignment_progress(uuid,text,text,text,boolean)
to service_role;

commit;
