begin;

create or replace function public.aora_set_task_template_active(
  p_organization_id uuid,
  p_template_id text,
  p_active boolean,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_template public.task_templates%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_paused integer:=0;
  v_resumed integer:=0;
begin
  select * into v_template
  from public.task_templates
  where organization_id=p_organization_id and id=p_template_id
  for update;

  if not found or v_template.deleted_at is not null then
    raise exception using errcode='P0002',message='task_template_not_found';
  end if;

  if coalesce(p_active,false) then
    update public.task_templates
      set active=true,updated_by=p_actor_id,updated_at=v_now
    where organization_id=p_organization_id and id=p_template_id and deleted_at is null;

    update public.task_rules
      set active=true,
          assignment_config=coalesce(assignment_config,'{}'::jsonb)-'_aoraPausedByTemplate',
          updated_by=p_actor_id,
          updated_at=v_now
    where organization_id=p_organization_id
      and template_id=p_template_id
      and deleted_at is null
      and coalesce(assignment_config->>'_aoraPausedByTemplate','false')='true';
    get diagnostics v_resumed=row_count;
  else
    select count(*)::integer into v_paused
    from public.task_rules
    where organization_id=p_organization_id
      and template_id=p_template_id
      and deleted_at is null
      and active=true;

    update public.task_rules
      set assignment_config=jsonb_set(
            coalesce(assignment_config,'{}'::jsonb),
            '{_aoraPausedByTemplate}',
            to_jsonb((coalesce(assignment_config->>'_aoraPausedByTemplate','false')='true') or active),
            true
          ),
          active=false,
          updated_by=p_actor_id,
          updated_at=v_now
    where organization_id=p_organization_id
      and template_id=p_template_id
      and deleted_at is null;

    update public.task_templates
      set active=false,updated_by=p_actor_id,updated_at=v_now
    where organization_id=p_organization_id and id=p_template_id and deleted_at is null;
  end if;

  return jsonb_build_object(
    'templateId',p_template_id,
    'active',coalesce(p_active,false),
    'pausedRules',v_paused,
    'resumedRules',v_resumed
  );
end
$$;

create or replace function public.aora_soft_delete_task_template(
  p_organization_id uuid,
  p_template_id text,
  p_actor_id text,
  p_reason text default 'Vom Manager gelöscht'
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_template public.task_templates%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_rules integer:=0;
begin
  select * into v_template
  from public.task_templates
  where organization_id=p_organization_id and id=p_template_id
  for update;

  if not found or v_template.deleted_at is not null then
    raise exception using errcode='P0002',message='task_template_not_found';
  end if;

  update public.task_rules
    set active=false,
        deleted_at=coalesce(deleted_at,v_now),
        deleted_by=coalesce(deleted_by,p_actor_id),
        delete_reason=coalesce(delete_reason,nullif(p_reason,''),'Template gelöscht'),
        updated_by=p_actor_id,
        updated_at=v_now
  where organization_id=p_organization_id
    and template_id=p_template_id
    and deleted_at is null;
  get diagnostics v_rules=row_count;

  update public.task_templates
    set active=false,
        deleted_at=v_now,
        deleted_by=p_actor_id,
        delete_reason=coalesce(nullif(p_reason,''),'Vom Manager gelöscht'),
        updated_by=p_actor_id,
        updated_at=v_now
  where organization_id=p_organization_id and id=p_template_id;

  return jsonb_build_object('templateId',p_template_id,'deleted',true,'deletedRules',v_rules);
end
$$;

create or replace function public.aora_cancel_task_instance(
  p_organization_id uuid,
  p_task_id text,
  p_actor_id text,
  p_reason text default 'Vom Manager abgebrochen'
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_task public.task_instances%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_assignments integer:=0;
begin
  select * into v_task
  from public.task_instances
  where organization_id=p_organization_id and id=p_task_id
  for update;

  if not found or v_task.deleted_at is not null then
    raise exception using errcode='P0002',message='task_instance_not_found';
  end if;

  update public.task_assignments
    set status='cancelled'
  where organization_id=p_organization_id
    and task_instance_id=p_task_id
    and status in ('assigned','in_progress');
  get diagnostics v_assignments=row_count;

  update public.task_instances
    set status='cancelled',
        blocking_clockout=false,
        version=version+1,
        updated_at=v_now,
        payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
          'cancelledAt',v_now,
          'cancelledBy',p_actor_id,
          'cancelReason',coalesce(nullif(p_reason,''),'Vom Manager abgebrochen')
        )
  where organization_id=p_organization_id and id=p_task_id;

  return jsonb_build_object('taskId',p_task_id,'status','cancelled','cancelledAssignments',v_assignments);
end
$$;

create or replace function public.aora_soft_delete_task_instance(
  p_organization_id uuid,
  p_task_id text,
  p_actor_id text,
  p_reason text default 'Vom Manager gelöscht'
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_task public.task_instances%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  select * into v_task
  from public.task_instances
  where organization_id=p_organization_id and id=p_task_id
  for update;

  if not found or v_task.deleted_at is not null then
    raise exception using errcode='P0002',message='task_instance_not_found';
  end if;

  update public.task_assignments
    set status='cancelled'
  where organization_id=p_organization_id
    and task_instance_id=p_task_id
    and status in ('assigned','in_progress');

  update public.notifications
    set deleted_at=coalesce(deleted_at,v_now)
  where organization_id=p_organization_id
    and related_entity_type='task'
    and related_entity_id=p_task_id
    and deleted_at is null;

  update public.task_instances
    set status='cancelled',
        blocking_clockout=false,
        deleted_at=v_now,
        deleted_by=p_actor_id,
        delete_reason=coalesce(nullif(p_reason,''),'Vom Manager gelöscht'),
        version=version+1,
        updated_at=v_now,
        payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
          'deletedAt',v_now,
          'deletedBy',p_actor_id
        )
  where organization_id=p_organization_id and id=p_task_id;

  return jsonb_build_object('taskId',p_task_id,'deleted',true);
end
$$;

revoke all on function public.aora_set_task_template_active(uuid,text,boolean,text) from public;
revoke all on function public.aora_soft_delete_task_template(uuid,text,text,text) from public;
revoke all on function public.aora_cancel_task_instance(uuid,text,text,text) from public;
revoke all on function public.aora_soft_delete_task_instance(uuid,text,text,text) from public;

grant execute on function public.aora_set_task_template_active(uuid,text,boolean,text) to service_role;
grant execute on function public.aora_soft_delete_task_template(uuid,text,text,text) to service_role;
grant execute on function public.aora_cancel_task_instance(uuid,text,text,text) to service_role;
grant execute on function public.aora_soft_delete_task_instance(uuid,text,text,text) to service_role;

commit;
