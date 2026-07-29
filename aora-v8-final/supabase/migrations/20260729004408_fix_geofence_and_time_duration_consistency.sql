create schema if not exists private;

create or replace function private.aora_recalculate_time_entry_duration(p_entry jsonb)
returns jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
declare
  v_start text := p_entry->>'start';
  v_end text := p_entry->>'end';
  v_break integer := 0;
  v_start_minutes integer;
  v_end_minutes integer;
  v_gross integer;
  v_duration integer;
begin
  if v_start is null or v_end is null
    or v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  then
    return p_entry;
  end if;

  if coalesce(p_entry->>'breakMinutes', '') ~ '^[0-9]+$' then
    v_break := greatest(0, (p_entry->>'breakMinutes')::integer);
  end if;

  v_start_minutes := split_part(v_start, ':', 1)::integer * 60 + split_part(v_start, ':', 2)::integer;
  v_end_minutes := split_part(v_end, ':', 1)::integer * 60 + split_part(v_end, ':', 2)::integer;
  v_gross := v_end_minutes - v_start_minutes;
  if v_gross < 0 then v_gross := v_gross + 1440; end if;
  v_duration := greatest(0, v_gross - v_break);

  return jsonb_set(p_entry, '{durationMinutes}', to_jsonb(v_duration), true);
end;
$$;

create or replace function public.aora_decide_time_correction_atomic(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_correction_id uuid,
  p_decision text,
  p_actor_id text,
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
  v_new_value jsonb;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;

  select *
  into c
  from public.time_entry_corrections
  where id = p_correction_id and organization_id = p_organization_id
  for update;

  if not found or c.status <> 'pending' then raise exception 'correction_not_pending'; end if;
  if p_decision = 'approved' and p_state is null then raise exception 'corrected_state_required'; end if;

  v_new_value := p_new_value;
  if p_decision = 'approved' then
    v_new_value := private.aora_recalculate_time_entry_duration(p_new_value);
    select jsonb_set(
      p_state,
      '{timeEntries}',
      coalesce(
        jsonb_agg(
          case
            when item.value->>'id' = c.time_entry_id then private.aora_recalculate_time_entry_duration(item.value)
            else item.value
          end
          order by item.ordinality
        ),
        '[]'::jsonb
      ),
      true
    )
    into v_state
    from jsonb_array_elements(coalesce(p_state->'timeEntries', '[]'::jsonb)) with ordinality as item(value, ordinality);

    v_revision := public.aora_commit_workspace_state(
      p_organization_id,
      p_expected_revision,
      v_state,
      'admin',
      p_actor_id,
      'MANUAL_CORRECTION',
      jsonb_build_object('correctionId', p_correction_id, 'timeEntryId', c.time_entry_id),
      'time_entry',
      c.time_entry_id,
      c.location_id
    );
  else
    select revision into v_revision
    from public.workspace_snapshots
    where organization_id = p_organization_id;
  end if;

  update public.time_entry_corrections
  set status = p_decision,
      decided_by = p_actor_id,
      decision_reason = p_decision_reason,
      decided_at = clock_timestamp()
  where id = p_correction_id;

  v_event := public.aora_append_time_entry_event(
    p_organization_id,
    c.time_entry_id,
    c.employee_id,
    c.location_id,
    case when p_decision = 'approved' then 'CORRECTION_APPROVED' else 'CORRECTION_REJECTED' end,
    'admin',
    p_actor_id,
    p_previous_value,
    v_new_value,
    coalesce(nullif(p_decision_reason, ''), c.reason),
    p_rule_set_version,
    jsonb_build_object('correctionId', p_correction_id)
  );

  next_revision := v_revision;
  event_id := v_event;
  return next;
end;
$$;

revoke all on function private.aora_recalculate_time_entry_duration(jsonb) from public, anon, authenticated;
grant execute on function private.aora_recalculate_time_entry_duration(jsonb) to service_role;

revoke all on function public.aora_decide_time_correction_atomic(uuid,bigint,uuid,text,text,text,jsonb,jsonb,jsonb,integer) from public, anon, authenticated;
grant execute on function public.aora_decide_time_correction_atomic(uuid,bigint,uuid,text,text,text,jsonb,jsonb,jsonb,integer) to service_role;
