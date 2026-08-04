begin;

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

  select correction.* into c
  from public.time_entry_corrections as correction
  where correction.id = p_correction_id
    and correction.organization_id = p_organization_id
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
    select snapshot.revision into v_revision
    from public.workspace_snapshots as snapshot
    where snapshot.organization_id = p_organization_id;
    v_event_type := case
      when c.approval_target = 'employee' then 'MANAGER_TIME_CHANGE_REJECTED'
      else 'EMPLOYEE_TIME_CHANGE_REJECTED'
    end;
  end if;

  update public.time_entry_corrections as correction
  set status = p_decision,
      decided_by = p_actor_id,
      decision_reason = nullif(trim(coalesce(p_decision_reason,'')),''),
      decided_at = clock_timestamp()
  where correction.id = c.id
    and correction.organization_id = p_organization_id;

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

revoke all on function public.aora_decide_time_change_atomic(uuid,bigint,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,integer) from public, anon, authenticated;
grant execute on function public.aora_decide_time_change_atomic(uuid,bigint,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,integer) to service_role;

commit;
