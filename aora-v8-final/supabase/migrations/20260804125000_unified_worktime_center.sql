begin;

alter table public.time_entry_corrections
  add column if not exists approval_target text;

alter table public.time_entry_corrections
  add column if not exists change_type text;

update public.time_entry_corrections
set approval_target = case
  when requested_by_type = 'employee' then 'manager'
  else 'employee'
end
where approval_target is null;

update public.time_entry_corrections
set change_type = 'edit_entry'
where change_type is null;

alter table public.time_entry_corrections
  alter column approval_target set default 'manager',
  alter column approval_target set not null,
  alter column change_type set default 'edit_entry',
  alter column change_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'time_entry_corrections_approval_target_check'
      and conrelid = 'public.time_entry_corrections'::regclass
  ) then
    alter table public.time_entry_corrections
      add constraint time_entry_corrections_approval_target_check
      check (approval_target in ('manager','employee'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'time_entry_corrections_change_type_check'
      and conrelid = 'public.time_entry_corrections'::regclass
  ) then
    alter table public.time_entry_corrections
      add constraint time_entry_corrections_change_type_check
      check (change_type in ('edit_entry','create_entry'));
  end if;
end $$;

create index if not exists time_entry_corrections_workflow_idx
  on public.time_entry_corrections (organization_id, approval_target, status, requested_at desc);

create index if not exists time_entry_corrections_employee_workflow_idx
  on public.time_entry_corrections (organization_id, employee_id, approval_target, status, requested_at desc);

create or replace function public.aora_create_manager_time_change_atomic(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_time_entry_id text,
  p_employee_id text,
  p_location_id text,
  p_actor_id text,
  p_previous_value jsonb,
  p_proposed_value jsonb,
  p_reason text,
  p_change_type text,
  p_state jsonb
)
returns table(correction_id uuid, next_revision bigint, event_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_correction_id uuid;
  v_revision bigint;
  v_event_id uuid;
begin
  if p_change_type not in ('edit_entry','create_entry') then
    raise exception 'invalid_change_type';
  end if;
  if length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'reason_required';
  end if;
  if p_state is null then
    raise exception 'state_required';
  end if;

  insert into public.time_entry_corrections(
    organization_id,
    time_entry_id,
    employee_id,
    location_id,
    requested_by_type,
    requested_by_id,
    previous_value,
    proposed_value,
    reason,
    status,
    approval_target,
    change_type
  ) values (
    p_organization_id,
    p_time_entry_id,
    p_employee_id,
    p_location_id,
    'manager',
    p_actor_id,
    coalesce(p_previous_value,'{}'::jsonb),
    coalesce(p_proposed_value,'{}'::jsonb),
    trim(p_reason),
    'pending',
    'employee',
    p_change_type
  ) returning id into v_correction_id;

  v_revision := public.aora_commit_workspace_state(
    p_organization_id,
    p_expected_revision,
    p_state,
    'admin',
    p_actor_id,
    'MANAGER_TIME_CHANGE_REQUESTED',
    jsonb_build_object(
      'correctionId', v_correction_id,
      'timeEntryId', p_time_entry_id,
      'employeeId', p_employee_id,
      'changeType', p_change_type
    ),
    'time_entry_correction',
    v_correction_id::text,
    p_location_id
  );

  v_event_id := public.aora_append_time_entry_event(
    p_organization_id,
    p_time_entry_id,
    p_employee_id,
    p_location_id,
    'MANAGER_CHANGE_REQUESTED',
    'manager',
    p_actor_id,
    p_previous_value,
    p_proposed_value,
    trim(p_reason),
    null,
    jsonb_build_object(
      'correctionId', v_correction_id,
      'approvalTarget', 'employee',
      'changeType', p_change_type
    )
  );

  correction_id := v_correction_id;
  next_revision := v_revision;
  event_id := v_event_id;
  return next;
end;
$$;

create or replace function public.aora_manager_direct_punch_atomic(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_time_entry_id text,
  p_employee_id text,
  p_location_id text,
  p_actor_id text,
  p_actor_type text,
  p_action text,
  p_previous_value jsonb,
  p_new_value jsonb,
  p_reason text
)
returns table(next_revision bigint, event_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
  v_event_id uuid;
  v_event_type text;
begin
  if p_action not in ('in','out','pause','resume') then
    raise exception 'invalid_punch_action';
  end if;
  if p_actor_type not in ('owner','manager') then
    raise exception 'invalid_actor_type';
  end if;
  if length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'reason_required';
  end if;

  v_event_type := case p_action
    when 'in' then 'MANAGER_DIRECT_CLOCK_IN'
    when 'out' then 'MANAGER_DIRECT_CLOCK_OUT'
    when 'pause' then 'MANAGER_DIRECT_PAUSE_START'
    when 'resume' then 'MANAGER_DIRECT_PAUSE_END'
  end;

  v_revision := public.aora_commit_workspace_state(
    p_organization_id,
    p_expected_revision,
    p_state,
    'admin',
    p_actor_id,
    v_event_type,
    jsonb_build_object(
      'timeEntryId', p_time_entry_id,
      'employeeId', p_employee_id,
      'action', p_action,
      'reason', trim(p_reason),
      'source', 'manager_direct'
    ),
    'time_entry',
    p_time_entry_id,
    p_location_id
  );

  v_event_id := public.aora_append_time_entry_event(
    p_organization_id,
    p_time_entry_id,
    p_employee_id,
    p_location_id,
    v_event_type,
    p_actor_type,
    p_actor_id,
    p_previous_value,
    p_new_value,
    trim(p_reason),
    null,
    jsonb_build_object('source','manager_direct','approvalRequired',false)
  );

  next_revision := v_revision;
  event_id := v_event_id;
  return next;
end;
$$;

create or replace function public.aora_decide_time_change_atomic(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_correction_id uuid,
  p_decision text,
  p_actor_type text,
  p_actor_id text,
  p_expected_approval_target text,
  p_decision_reason text,
  p_state jsonb,
  p_previous_value jsonb,
  p_new_value jsonb,
  p_rule_set_version integer default null
)
returns table(next_revision bigint, event_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.time_entry_corrections%rowtype;
  v_revision bigint;
  v_event uuid;
  v_state jsonb;
  v_event_type text;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'invalid_decision';
  end if;
  if p_actor_type not in ('owner','manager','employee') then
    raise exception 'invalid_actor_type';
  end if;
  if p_expected_approval_target not in ('manager','employee') then
    raise exception 'invalid_approval_target';
  end if;

  select * into c
  from public.time_entry_corrections
  where id = p_correction_id
    and organization_id = p_organization_id
  for update;

  if not found or c.status <> 'pending' then
    raise exception 'correction_not_pending';
  end if;
  if c.approval_target <> p_expected_approval_target then
    raise exception 'wrong_approval_target';
  end if;
  if p_decision = 'approved' and p_state is null then
    raise exception 'corrected_state_required';
  end if;

  if p_decision = 'approved' then
    select jsonb_set(
      p_state,
      '{timeEntries}',
      coalesce(
        jsonb_agg(
          case
            when item.value->>'id' = c.time_entry_id
              then private.aora_recalculate_time_entry_duration(item.value)
            else item.value
          end
          order by item.ordinality
        ),
        '[]'::jsonb
      ),
      true
    ) into v_state
    from jsonb_array_elements(coalesce(p_state->'timeEntries','[]'::jsonb))
      with ordinality as item(value, ordinality);

    v_event_type := case
      when c.approval_target = 'employee' then 'MANAGER_TIME_CHANGE_CONFIRMED'
      else 'EMPLOYEE_TIME_CHANGE_APPROVED'
    end;

    v_revision := public.aora_commit_workspace_state(
      p_organization_id,
      p_expected_revision,
      v_state,
      case when p_actor_type = 'employee' then 'employee' else 'admin' end,
      p_actor_id,
      v_event_type,
      jsonb_build_object(
        'correctionId', c.id,
        'timeEntryId', c.time_entry_id,
        'employeeId', c.employee_id,
        'changeType', c.change_type,
        'approvedBy', p_actor_type
      ),
      'time_entry',
      c.time_entry_id,
      c.location_id
    );
  else
    select revision into v_revision
    from public.workspace_snapshots
    where organization_id = p_organization_id;
    v_event_type := case
      when c.approval_target = 'employee' then 'MANAGER_TIME_CHANGE_REJECTED'
      else 'EMPLOYEE_TIME_CHANGE_REJECTED'
    end;
  end if;

  update public.time_entry_corrections
  set status = p_decision,
      decided_by = p_actor_id,
      decision_reason = nullif(trim(coalesce(p_decision_reason,'')),''),
      decided_at = clock_timestamp()
  where id = c.id;

  v_event := public.aora_append_time_entry_event(
    p_organization_id,
    c.time_entry_id,
    c.employee_id,
    c.location_id,
    v_event_type,
    p_actor_type,
    p_actor_id,
    p_previous_value,
    p_new_value,
    coalesce(nullif(trim(coalesce(p_decision_reason,'')),''), c.reason),
    p_rule_set_version,
    jsonb_build_object(
      'correctionId', c.id,
      'approvalTarget', c.approval_target,
      'changeType', c.change_type
    )
  );

  next_revision := v_revision;
  event_id := v_event;
  return next;
end;
$$;

revoke all on function public.aora_create_manager_time_change_atomic(uuid,bigint,text,text,text,text,jsonb,jsonb,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.aora_manager_direct_punch_atomic(uuid,bigint,jsonb,text,text,text,text,text,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.aora_decide_time_change_atomic(uuid,bigint,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,integer) from public, anon, authenticated;

grant execute on function public.aora_create_manager_time_change_atomic(uuid,bigint,text,text,text,text,jsonb,jsonb,text,text,jsonb) to service_role;
grant execute on function public.aora_manager_direct_punch_atomic(uuid,bigint,jsonb,text,text,text,text,text,text,jsonb,jsonb,text) to service_role;
grant execute on function public.aora_decide_time_change_atomic(uuid,bigint,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,integer) to service_role;

commit;
