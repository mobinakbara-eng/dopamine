begin;

-- A task instance can have more than one assignee. Answers therefore belong
-- to the assignee as well as the template item; the old key let one employee
-- overwrite another employee's answer.
lock table public.task_answers in access exclusive mode;

do $$
declare
  current_primary_key text;
begin
  select constraint_name
  into current_primary_key
  from information_schema.table_constraints
  where table_schema = 'public'
    and table_name = 'task_answers'
    and constraint_type = 'PRIMARY KEY';

  if current_primary_key is not null then
    execute format(
      'alter table public.task_answers drop constraint %I',
      current_primary_key
    );
  end if;
end
$$;

alter table public.task_answers
  add constraint task_answers_pkey primary key (
    organization_id,
    task_instance_id,
    template_item_id,
    employee_id
  );

drop index if exists public.task_answers_instance_idx;
create index task_answers_instance_idx
  on public.task_answers (
    organization_id,
    task_instance_id,
    employee_id,
    template_item_id
  );

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
  v_now timestamptz := clock_timestamp();
  v_current_version integer;
  v_assignment_count integer;
  v_remaining_count integer;
  v_instance_status text;
  v_affected integer;
begin
  if nullif(p_task_instance_id, '') is null
     or nullif(p_employee_id, '') is null
     or p_assignment_status not in ('in_progress', 'completed') then
    raise exception 'invalid_task_assignment_progress';
  end if;

  select instance.version
  into v_current_version
  from public.task_instances instance
  where instance.organization_id = p_organization_id
    and instance.id = p_task_instance_id
    and instance.deleted_at is null
  for update;
  if not found then raise exception 'task_instance_not_found'; end if;

  update public.task_assignments assignment
  set status = p_assignment_status,
      accepted_at = coalesce(assignment.accepted_at, v_now),
      completed_at = case when p_assignment_status = 'completed' then v_now else null end
  where assignment.organization_id = p_organization_id
    and assignment.task_instance_id = p_task_instance_id
    and assignment.employee_id = p_employee_id
    and assignment.status <> 'cancelled';
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then raise exception 'task_assignment_not_found'; end if;

  select count(*), count(*) filter (where assignment.status <> 'completed')
  into v_assignment_count, v_remaining_count
  from public.task_assignments assignment
  where assignment.organization_id = p_organization_id
    and assignment.task_instance_id = p_task_instance_id
    and assignment.status <> 'cancelled';
  if v_assignment_count = 0 then raise exception 'task_assignment_not_found'; end if;

  v_instance_status := case
    when v_remaining_count > 0 then 'in_progress'
    when coalesce(p_review_required, false) then 'submitted'
    else 'completed'
  end;

  update public.task_instances
  set status = v_instance_status,
      completed_at = case when v_instance_status = 'completed' then coalesce(completed_at, v_now) else null end,
      version = v_current_version + 1,
      updated_at = v_now
  where organization_id = p_organization_id
    and id = p_task_instance_id;

  return jsonb_build_object('status', v_instance_status, 'version', v_current_version + 1);
end;
$function$;

revoke all on function public.aora_update_task_assignment_progress(uuid,text,text,text,boolean)
from public, anon, authenticated;
grant execute on function public.aora_update_task_assignment_progress(uuid,text,text,text,boolean)
to service_role;

commit;
