begin;

create or replace function public.aora_create_scheduled_task_atomic(
  p_organization_id uuid,
  p_rule_id text,
  p_template_id text,
  p_template_version integer,
  p_location_id text,
  p_shift_id text,
  p_employee_id text,
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
  v_notification_id text;
  v_notification_key text;
  v_now timestamptz:=clock_timestamp();
begin
  if p_organization_id is null or p_rule_id is null or p_template_id is null or p_location_id is null or p_scheduled_for is null or p_instance_date is null then
    raise exception using errcode='22023',message='Scheduled task input is incomplete.';
  end if;

  if p_rule_id like 'manual:%' and not exists(
    select 1 from public.task_rules where organization_id=p_organization_id and id=p_rule_id
  ) then
    insert into public.task_rules(
      organization_id,id,location_id,template_id,trigger_type,trigger_config,
      assignment_strategy,assignment_config,due_offset_minutes,clockout_policy,
      active,version,created_by,updated_by,created_at,updated_at
    ) values(
      p_organization_id,p_rule_id,p_location_id,p_template_id,'manual',
      jsonb_build_object('manual',true,'createdAt',v_now),
      case when p_employee_id is null then 'first_claim' else 'specific_employee' end,
      case when p_employee_id is null then '{}'::jsonb else jsonb_build_object('employeeId',p_employee_id) end,
      0,case when p_blocking_clockout then 'MANAGER_OVERRIDE' else 'WARN_ONLY' end,
      false,1,p_payload->>'createdBy',p_payload->>'createdBy',v_now,v_now
    );
  end if;

  insert into public.task_generation_keys(organization_id,rule_id,scheduled_for,employee_id,task_instance_id)
  values(p_organization_id,p_rule_id,p_scheduled_for,p_employee_id,null)
  on conflict(organization_id,rule_id,scheduled_for,employee_id) do nothing
  returning id into v_key_id;

  if v_key_id is null then
    select task_instance_id into v_existing_task_id
    from public.task_generation_keys
    where organization_id=p_organization_id and rule_id=p_rule_id
      and scheduled_for=p_scheduled_for and employee_id is not distinct from p_employee_id;
    return jsonb_build_object('created',false,'idempotent',true,'taskId',v_existing_task_id,'notificationCount',0);
  end if;

  v_task_id='task_'||replace(gen_random_uuid()::text,'-','');
  insert into public.task_instances(
    organization_id,id,template_id,template_version,rule_id,location_id,shift_id,instance_date,
    scheduled_for,due_at,status,blocking_clockout,version,payload,created_at,updated_at
  ) values(
    p_organization_id,v_task_id,p_template_id,greatest(coalesce(p_template_version,1),1),p_rule_id,p_location_id,p_shift_id,p_instance_date,
    p_scheduled_for,p_due_at,'open',coalesce(p_blocking_clockout,false),1,coalesce(p_payload,'{}'::jsonb),v_now,v_now
  );

  if p_employee_id is not null then
    insert into public.task_assignments(organization_id,task_instance_id,employee_id,assigned_at,status)
    values(p_organization_id,v_task_id,p_employee_id,v_now,'assigned');

    v_notification_id='note_'||replace(gen_random_uuid()::text,'-','');
    v_notification_key='task:'||v_task_id||':employee:'||p_employee_id;
    insert into public.notifications(
      organization_id,id,employee_id,location_id,type,title,body,related_entity_type,related_entity_id,
      read,created_at,payload,idempotency_key
    ) values(
      p_organization_id,v_notification_id,p_employee_id,p_location_id,'task_assigned',coalesce(nullif(p_title,''),'Neue Aufgabe'),
      'Fällig bis '||to_char(p_due_at at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI'),
      'task',v_task_id,false,v_now,jsonb_build_object('taskId',v_task_id,'dueAt',p_due_at),v_notification_key
    ) on conflict(organization_id,idempotency_key) where idempotency_key is not null do nothing;

    select id into v_notification_id from public.notifications
    where organization_id=p_organization_id and idempotency_key=v_notification_key;
    if v_notification_id is not null then
      insert into public.notification_deliveries(
        organization_id,notification_id,channel,status,attempts,idempotency_key,sent_at,delivered_at,next_attempt_at
      ) values
        (p_organization_id,v_notification_id,'in_app','delivered',1,v_notification_key||':in_app',v_now,v_now,null),
        (p_organization_id,v_notification_id,'web_push','pending',0,v_notification_key||':web_push',null,null,v_now)
      on conflict(organization_id,idempotency_key) do nothing;
    end if;
  end if;

  update public.task_generation_keys set task_instance_id=v_task_id where id=v_key_id;
  return jsonb_build_object('created',true,'idempotent',false,'taskId',v_task_id,'notificationCount',case when p_employee_id is null then 0 else 1 end);
end $$;

commit;
