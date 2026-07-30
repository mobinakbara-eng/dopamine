begin;

create or replace function public.aora_decide_open_shift_atomic(
  p_token text,
  p_request_id text,
  p_decision text,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session record;
  v_request public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_scope text;
  v_existing jsonb;
  v_response jsonb;
  v_state jsonb;
  v_revision bigint;
  v_next_revision bigint;
  v_now timestamptz := clock_timestamp();
  v_note_id text := 'note_' || replace(gen_random_uuid()::text,'-','');
  v_audit_id text := 'audit_' || replace(gen_random_uuid()::text,'-','');
begin
  if p_decision not in ('approved','rejected') then
    raise exception using errcode='22023', message='Ungültige Entscheidung.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='22023', message='Idempotency-Key fehlt.';
  end if;

  select * into v_session from public.validate_demo_session(p_token) limit 1;
  if v_session.organization_id is null then
    raise exception using errcode='28000', message='Sitzung ist ungültig oder abgelaufen.';
  end if;
  if v_session.role <> 'admin' then
    raise exception using errcode='42501', message='Nur Inhaber oder Manager dürfen Schichtanfragen entscheiden.';
  end if;

  select response into v_existing
  from public.idempotency_records
  where organization_id=v_session.organization_id
    and action='shift_request_decision'
    and actor_id=v_session.subject_id
    and idempotency_key=p_idempotency_key
    and status='completed';
  if found then return v_existing; end if;

  insert into public.idempotency_records(organization_id,action,actor_id,idempotency_key)
  values (v_session.organization_id,'shift_request_decision',v_session.subject_id,p_idempotency_key)
  on conflict do nothing;

  select * into v_request
  from public.shift_requests
  where organization_id=v_session.organization_id and id=p_request_id and deleted_at is null
  for update;
  if not found then raise exception using errcode='P0002', message='Schichtanfrage wurde nicht gefunden.'; end if;

  select * into v_shift
  from public.shifts
  where organization_id=v_session.organization_id and id=v_request.shift_id and deleted_at is null
  for update;
  if not found then raise exception using errcode='P0002', message='Schicht wurde nicht gefunden.'; end if;

  select coalesce(payload->>'scope','manager') into v_scope
  from public.admins
  where organization_id=v_session.organization_id and id=v_session.subject_id;
  if coalesce(v_scope,'manager') <> 'owner' and not exists (
    select 1 from public.manager_location_access
    where organization_id=v_session.organization_id
      and manager_id=v_session.subject_id
      and location_id=v_shift.location_id
  ) then
    raise exception using errcode='42501', message='Kein Zugriff auf diesen Standort.';
  end if;

  if v_request.status <> 'pending' then
    raise exception using errcode='40001', message='Diese Anfrage wurde bereits entschieden.';
  end if;
  if p_decision='approved' and (v_shift.status <> 'open' or v_shift.employee_id is not null) then
    raise exception using errcode='40001', message='Die offene Schicht wurde bereits vergeben.';
  end if;

  select state,revision into v_state,v_revision
  from public.workspace_snapshots
  where organization_id=v_session.organization_id
  for update;
  if not found then raise exception using errcode='P0002',message='Arbeitsbereich wurde nicht gefunden.'; end if;

  if p_decision='approved' then
    v_state=jsonb_set(v_state,'{shifts}',coalesce((
      select jsonb_agg(
        case when item->>'id'=v_shift.id then
          item || jsonb_build_object(
            'employeeId',v_request.employee_id,
            'status','confirmed',
            'version',coalesce((item->>'version')::integer,1)+1,
            'updatedAt',v_now,
            'updatedBy',v_session.subject_id
          )
        else item end
      ) from jsonb_array_elements(coalesce(v_state->'shifts','[]'::jsonb)) item
    ),'[]'::jsonb),true);

    v_state=jsonb_set(v_state,'{shiftRequests}',coalesce((
      select jsonb_agg(
        case when item->>'shiftId'=v_shift.id and coalesce(item->>'status','pending')='pending' then
          item || jsonb_build_object(
            'status',case when item->>'id'=v_request.id then 'approved' else 'filled' end,
            'decidedAt',v_now,
            'decidedBy',v_session.subject_id,
            'reason',case when item->>'id'=v_request.id then coalesce(nullif(p_reason,''),item->>'reason','') else coalesce(item->>'reason','') end
          )
        else item end
      ) from jsonb_array_elements(coalesce(v_state->'shiftRequests','[]'::jsonb)) item
    ),'[]'::jsonb),true);
  else
    v_state=jsonb_set(v_state,'{shiftRequests}',coalesce((
      select jsonb_agg(
        case when item->>'id'=v_request.id then
          item || jsonb_build_object(
            'status','rejected','decidedAt',v_now,'decidedBy',v_session.subject_id,
            'reason',coalesce(nullif(p_reason,''),item->>'reason','')
          )
        else item end
      ) from jsonb_array_elements(coalesce(v_state->'shiftRequests','[]'::jsonb)) item
    ),'[]'::jsonb),true);
  end if;

  v_state=jsonb_set(v_state,'{notifications}',coalesce(v_state->'notifications','[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'id',v_note_id,
      'employeeId',v_request.employee_id,
      'locationId',v_shift.location_id,
      'type','shift_request_decision',
      'title',case when p_decision='approved' then 'Schicht bestätigt' else 'Schichtanfrage abgelehnt' end,
      'body',case when p_decision='approved' then 'Deine Anfrage für die offene Schicht wurde bestätigt.' else coalesce(nullif(p_reason,''),'Deine Anfrage wurde abgelehnt.') end,
      'relatedEntityType','shift',
      'relatedEntityId',v_shift.id,
      'read',false,
      'createdAt',v_now,
      'idempotencyKey','shift-decision:'||v_request.id||':'||p_decision
    )
  ),true);

  v_state=jsonb_set(v_state,'{audit}',coalesce(v_state->'audit','[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'id',v_audit_id,
      'action','SHIFT_REQUEST_'||upper(p_decision),
      'actor',v_session.subject_id,
      'actorType','admin',
      'actorId',v_session.subject_id,
      'entity','shift_request',
      'entityType','shift_request',
      'entityId',v_request.id,
      'createdAt',v_now,
      'payload',jsonb_build_object('shiftId',v_shift.id,'employeeId',v_request.employee_id,'reason',p_reason),
      'metadata',jsonb_build_object('locationId',v_shift.location_id,'idempotencyKey',p_idempotency_key)
    )
  ),true);

  v_state=jsonb_set(v_state,'{meta}',coalesce(v_state->'meta','{}'::jsonb) || jsonb_build_object(
    'revision',v_revision+1,'updatedAt',v_now,'variant','isolated-v8-final'
  ),true);

  v_next_revision=public.aora_commit_workspace_state(
    v_session.organization_id,v_revision,v_state,'admin',v_session.subject_id,
    'SHIFT_REQUEST_'||upper(p_decision),
    jsonb_build_object('shiftId',v_shift.id,'requestId',v_request.id,'employeeId',v_request.employee_id,'decision',p_decision),
    'shift_request',v_request.id,v_shift.location_id
  );

  v_response=jsonb_build_object(
    'requestId',v_request.id,
    'shiftId',v_shift.id,
    'employeeId',v_request.employee_id,
    'decision',p_decision,
    'revision',v_next_revision,
    'serverTime',v_now
  );
  update public.idempotency_records
  set status='completed',response=v_response,updated_at=v_now
  where organization_id=v_session.organization_id
    and action='shift_request_decision'
    and actor_id=v_session.subject_id
    and idempotency_key=p_idempotency_key;
  return v_response;
exception when others then
  update public.idempotency_records
  set status='failed',error=sqlerrm,updated_at=clock_timestamp()
  where organization_id=coalesce(v_session.organization_id,'00000000-0000-0000-0000-000000000000'::uuid)
    and action='shift_request_decision'
    and actor_id=coalesce(v_session.subject_id,'unknown')
    and idempotency_key=p_idempotency_key;
  raise;
end $$;

revoke all on function public.aora_decide_open_shift_atomic(text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.aora_decide_open_shift_atomic(text,text,text,text,uuid) to service_role;

commit;
