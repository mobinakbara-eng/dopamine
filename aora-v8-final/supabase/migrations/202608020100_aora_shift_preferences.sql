begin;

-- Reuse Aora's canonical shift_requests domain instead of introducing a
-- second request table. A preference has no shift until it is accepted.
alter table public.shift_requests alter column shift_id drop not null;

-- Migrate and remove the earlier staging-only experiment if it exists.
do $migration$
begin
  if to_regclass('public.aora_shift_preferences') is not null then
    execute $copy$
      insert into public.shift_requests(
        organization_id,id,shift_id,employee_id,location_id,request_type,status,reason,
        created_at,decided_at,decided_by,updated_at,payload
      )
      select
        organization_id,
        id::text,
        resulting_shift_id,
        employee_id,
        location_id,
        'shift_preference',
        status,
        coalesce(decision_reason,note),
        created_at,
        decided_at,
        decided_by,
        updated_at,
        jsonb_build_object(
          'id',id::text,
          'shiftId',resulting_shift_id,
          'employeeId',employee_id,
          'locationId',location_id,
          'requestType','shift_preference',
          'status',status,
          'date',preference_date::text,
          'start',to_char(start_time,'HH24:MI'),
          'end',to_char(end_time,'HH24:MI'),
          'breakMinutes',break_minutes,
          'note',coalesce(note,''),
          'reason',coalesce(decision_reason,''),
          'decidedBy',decided_by,
          'decidedAt',decided_at,
          'resultingShiftId',resulting_shift_id,
          'createdAt',created_at,
          'updatedAt',updated_at
        )
      from public.aora_shift_preferences
      on conflict(organization_id,id) do nothing
    $copy$;
  end if;
end;
$migration$;

drop function if exists public.aora_decide_shift_preference(uuid,uuid,bigint,text,text,text,text,text,jsonb);
drop table if exists public.aora_shift_preferences;

create index if not exists shift_requests_preference_scope_idx
  on public.shift_requests(organization_id,location_id,status,((payload->>'date')))
  where request_type='shift_preference' and deleted_at is null;

create index if not exists shift_requests_preference_employee_idx
  on public.shift_requests(organization_id,employee_id,((payload->>'date')) desc)
  where request_type='shift_preference' and deleted_at is null;

create unique index if not exists shift_requests_unique_pending_preference_idx
  on public.shift_requests(
    organization_id,
    employee_id,
    ((payload->>'date')),
    ((payload->>'start')),
    ((payload->>'end'))
  )
  where request_type='shift_preference' and status='pending' and deleted_at is null;

create or replace function public.aora_shift_preference_action(
  p_token text,
  p_action text,
  p_request_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key uuid default gen_random_uuid()
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $function$
declare
  v_session record;
  v_employee public.employees%rowtype;
  v_request public.shift_requests%rowtype;
  v_state jsonb;
  v_revision bigint;
  v_next_revision bigint;
  v_access_role text;
  v_admin_scope text;
  v_location_id text;
  v_request_id text;
  v_shift_id text;
  v_decision text;
  v_date date;
  v_start time;
  v_end time;
  v_break_minutes integer;
  v_note text;
  v_reason text;
  v_now timestamptz:=clock_timestamp();
  v_today date:=(clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_request_json jsonb;
  v_shift_json jsonb;
  v_rule_evaluation jsonb;
  v_response jsonb;
  v_existing jsonb;
  v_action_key text;
  v_event_type text;
  v_notification_id text;
  v_audit_id text;
  v_notification jsonb;
  v_audit jsonb;
begin
  if p_action not in ('create','cancel','decide') then
    raise exception using errcode='22023',message='Unbekannte Schichtwunsch-Aktion.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='Idempotency-Key fehlt.';
  end if;

  select * into v_session from public.validate_demo_session(p_token) limit 1;
  if v_session.organization_id is null then
    raise exception using errcode='28000',message='Sitzung ist ungültig oder abgelaufen.';
  end if;

  v_access_role:=case when v_session.role='admin' then 'manager' else v_session.role end;
  if v_session.role='admin' then
    select coalesce(payload->>'scope','manager') into v_admin_scope
    from public.admins
    where organization_id=v_session.organization_id
      and id=v_session.subject_id
      and deleted_at is null;
    if not found then
      raise exception using errcode='42501',message='Administrationszugang wurde deaktiviert.';
    end if;
    v_access_role:=case when v_admin_scope='owner' then 'owner' else 'manager' end;
  end if;

  v_action_key:='shift_preference_'||p_action;
  select response into v_existing
  from public.idempotency_records
  where organization_id=v_session.organization_id
    and action=v_action_key
    and actor_id=v_session.subject_id
    and idempotency_key=p_idempotency_key
    and status='completed';
  if found then return v_existing; end if;

  insert into public.idempotency_records(organization_id,action,actor_id,idempotency_key)
  values(v_session.organization_id,v_action_key,v_session.subject_id,p_idempotency_key)
  on conflict do nothing;

  select state,revision into v_state,v_revision
  from public.workspace_snapshots
  where organization_id=v_session.organization_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='Arbeitsbereich wurde nicht gefunden.';
  end if;

  v_state:=coalesce(v_state,'{}'::jsonb);
  for v_action_key in select unnest(array['shiftRequests','shifts','notifications','audit']) loop
    if jsonb_typeof(v_state->v_action_key) is distinct from 'array' then
      v_state:=jsonb_set(v_state,array[v_action_key],'[]'::jsonb,true);
    end if;
  end loop;
  v_action_key:='shift_preference_'||p_action;

  if p_action='create' then
    if v_session.role<>'employee' then
      raise exception using errcode='42501',message='Nur Mitarbeiter können Schichtwünsche abgeben.';
    end if;

    select * into v_employee
    from public.employees
    where organization_id=v_session.organization_id
      and id=v_session.subject_id
      and active=true
      and deleted_at is null;
    if not found then
      raise exception using errcode='42501',message='Mitarbeiterkonto wurde nicht gefunden.';
    end if;

    v_location_id:=coalesce(v_employee.primary_location_id,v_employee.location_id);
    if coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(p_payload->>'start','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       or coalesce(p_payload->>'end','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       or coalesce(p_payload->>'breakMinutes','0') !~ '^\d{1,3}$' then
      raise exception using errcode='22023',message='Datum, Uhrzeit oder Pause ist ungültig.';
    end if;
    v_date:=(p_payload->>'date')::date;
    v_start:=(p_payload->>'start')::time;
    v_end:=(p_payload->>'end')::time;
    v_break_minutes:=(coalesce(p_payload->>'breakMinutes','0'))::integer;
    v_note:=trim(coalesce(p_payload->>'note',''));

    if v_location_id is null then
      raise exception using errcode='22023',message='Für das Mitarbeiterkonto ist kein Standort hinterlegt.';
    end if;
    if v_date is null or v_date<v_today or v_date>v_today+180 then
      raise exception using errcode='22023',message='Schichtwünsche sind nur für die nächsten 180 Tage möglich.';
    end if;
    if v_start is null or v_end is null or v_end<=v_start then
      raise exception using errcode='22023',message='Ende muss nach dem Beginn liegen.';
    end if;
    if v_break_minutes<0 or v_break_minutes>180 then
      raise exception using errcode='22023',message='Pause ist ungültig.';
    end if;
    if extract(epoch from (v_end-v_start))/60-v_break_minutes<=0
       or extract(epoch from (v_end-v_start))/60-v_break_minutes>720 then
      raise exception using errcode='22023',message='Die gewünschte Schichtdauer ist ungültig.';
    end if;
    if char_length(v_note)>240 then
      raise exception using errcode='22023',message='Die Notiz darf höchstens 240 Zeichen enthalten.';
    end if;

    if exists(
      select 1 from public.shift_requests request
      where request.organization_id=v_session.organization_id
        and request.employee_id=v_session.subject_id
        and request.request_type='shift_preference'
        and request.status='pending'
        and request.deleted_at is null
        and request.payload->>'date'=v_date::text
        and (request.payload->>'start')::time<v_end
        and (request.payload->>'end')::time>v_start
    ) then
      raise exception using errcode='23505',message='Für diesen Zeitraum besteht bereits ein offener Schichtwunsch.';
    end if;

    v_request_id:='shift_request_'||replace(gen_random_uuid()::text,'-','');
    v_request_json:=jsonb_build_object(
      'id',v_request_id,
      'shiftId',null,
      'employeeId',v_session.subject_id,
      'locationId',v_location_id,
      'requestType','shift_preference',
      'status','pending',
      'date',v_date::text,
      'start',to_char(v_start,'HH24:MI'),
      'end',to_char(v_end,'HH24:MI'),
      'breakMinutes',v_break_minutes,
      'note',v_note,
      'reason','',
      'createdAt',v_now,
      'updatedAt',v_now,
      'idempotencyKey',p_idempotency_key
    );

    insert into public.shift_requests(
      organization_id,id,shift_id,employee_id,location_id,request_type,status,reason,
      created_at,idempotency_key,updated_at,payload
    ) values(
      v_session.organization_id,v_request_id,null,v_session.subject_id,v_location_id,
      'shift_preference','pending',v_note,v_now,p_idempotency_key,v_now,v_request_json
    );

    v_state:=jsonb_set(v_state,'{shiftRequests}',coalesce(v_state->'shiftRequests','[]'::jsonb)||jsonb_build_array(v_request_json),true);
    v_audit_id:='audit_'||replace(gen_random_uuid()::text,'-','');
    v_audit:=jsonb_build_object(
      'id',v_audit_id,
      'action','SHIFT_PREFERENCE_CREATED',
      'actor',v_session.subject_id,
      'actorType','employee',
      'actorId',v_session.subject_id,
      'entity','shift_request',
      'entityType','shift_request',
      'entityId',v_request_id,
      'createdAt',v_now,
      'metadata',jsonb_build_object('locationId',v_location_id,'date',v_date,'start',v_start,'end',v_end)
    );
    v_state:=jsonb_set(v_state,'{audit}',coalesce(v_state->'audit','[]'::jsonb)||jsonb_build_array(v_audit),true);
    insert into public.audit_logs(
      organization_id,id,action,actor,entity,entity_id,created_at,payload,location_id,actor_type,actor_id,entity_type,metadata
    ) values(
      v_session.organization_id,v_audit_id,'SHIFT_PREFERENCE_CREATED',v_session.subject_id,'shift_request',v_request_id,v_now,
      jsonb_build_object('date',v_date,'start',v_start,'end',v_end,'breakMinutes',v_break_minutes,'note',v_note),
      v_location_id,'employee',v_session.subject_id,'shift_request',jsonb_build_object('requestType','shift_preference')
    );
    v_event_type:='SHIFT_PREFERENCE_CREATED';

  elsif p_action='cancel' then
    if v_session.role<>'employee' then
      raise exception using errcode='42501',message='Nur Mitarbeiter können eigene Schichtwünsche zurückziehen.';
    end if;

    select * into v_request
    from public.shift_requests
    where organization_id=v_session.organization_id
      and id=p_request_id
      and request_type='shift_preference'
      and deleted_at is null
    for update;
    if not found then
      raise exception using errcode='P0002',message='Schichtwunsch wurde nicht gefunden.';
    end if;
    if v_request.employee_id<>v_session.subject_id then
      raise exception using errcode='42501',message='Dieser Schichtwunsch gehört zu einem anderen Mitarbeiter.';
    end if;
    if v_request.status<>'pending' then
      raise exception using errcode='40001',message='Der Schichtwunsch ist nicht mehr offen.';
    end if;

    v_location_id:=v_request.location_id;
    v_request_id:=v_request.id;
    v_request_json:=v_request.payload||jsonb_build_object(
      'status','cancelled','cancelledAt',v_now,'updatedAt',v_now
    );

    update public.shift_requests
    set status='cancelled',updated_at=v_now,payload=v_request_json
    where organization_id=v_session.organization_id and id=v_request.id;

    v_state:=jsonb_set(v_state,'{shiftRequests}',coalesce((
      select jsonb_agg(case when item->>'id'=v_request.id then v_request_json else item end)
      from jsonb_array_elements(coalesce(v_state->'shiftRequests','[]'::jsonb)) item
    ),'[]'::jsonb),true);
    v_audit_id:='audit_'||replace(gen_random_uuid()::text,'-','');
    v_audit:=jsonb_build_object(
      'id',v_audit_id,'action','SHIFT_PREFERENCE_CANCELLED','actor',v_session.subject_id,
      'actorType','employee','actorId',v_session.subject_id,'entity','shift_request','entityType','shift_request',
      'entityId',v_request.id,'createdAt',v_now,'metadata',jsonb_build_object('locationId',v_location_id)
    );
    v_state:=jsonb_set(v_state,'{audit}',coalesce(v_state->'audit','[]'::jsonb)||jsonb_build_array(v_audit),true);
    insert into public.audit_logs(
      organization_id,id,action,actor,entity,entity_id,created_at,payload,location_id,actor_type,actor_id,entity_type,metadata
    ) values(
      v_session.organization_id,v_audit_id,'SHIFT_PREFERENCE_CANCELLED',v_session.subject_id,'shift_request',v_request.id,v_now,
      '{}'::jsonb,v_location_id,'employee',v_session.subject_id,'shift_request',jsonb_build_object('requestType','shift_preference')
    );
    v_event_type:='SHIFT_PREFERENCE_CANCELLED';

  else
    if v_session.role<>'admin' then
      raise exception using errcode='42501',message='Nur Inhaber oder Manager können Schichtwünsche entscheiden.';
    end if;

    select * into v_request
    from public.shift_requests
    where organization_id=v_session.organization_id
      and id=p_request_id
      and request_type='shift_preference'
      and deleted_at is null
    for update;
    if not found then
      raise exception using errcode='P0002',message='Schichtwunsch wurde nicht gefunden.';
    end if;
    if v_request.status<>'pending' then
      raise exception using errcode='40001',message='Der Schichtwunsch wurde bereits entschieden.';
    end if;

    v_location_id:=v_request.location_id;
    if v_access_role<>'owner' and not exists(
      select 1 from public.manager_location_access
      where organization_id=v_session.organization_id
        and manager_id=v_session.subject_id
        and location_id=v_location_id
    ) then
      raise exception using errcode='42501',message='Kein Zugriff auf diesen Standort.';
    end if;

    v_decision:=lower(coalesce(p_payload->>'decision',''));
    if v_decision not in ('accepted','rejected') then
      raise exception using errcode='22023',message='Entscheidung ist ungültig.';
    end if;
    v_reason:=trim(coalesce(p_payload->>'reason',''));
    if char_length(v_reason)>240 then
      raise exception using errcode='22023',message='Die Entscheidungsnotiz darf höchstens 240 Zeichen enthalten.';
    end if;

    v_request_id:=v_request.id;
    v_date:=(v_request.payload->>'date')::date;
    if v_decision='accepted' and (
      (coalesce(p_payload#>>'{shift,start}',v_request.payload->>'start','') !~ '^([01]\d|2[0-3]):[0-5]\d$')
      or (coalesce(p_payload#>>'{shift,end}',v_request.payload->>'end','') !~ '^([01]\d|2[0-3]):[0-5]\d$')
      or (coalesce(p_payload#>>'{shift,breakMinutes}',v_request.payload->>'breakMinutes','0') !~ '^\d{1,3}$')
    ) then
      raise exception using errcode='22023',message='Schichtzeit oder Pause ist ungültig.';
    end if;
    v_start:=coalesce(nullif(p_payload#>>'{shift,start}','')::time,(v_request.payload->>'start')::time);
    v_end:=coalesce(nullif(p_payload#>>'{shift,end}','')::time,(v_request.payload->>'end')::time);
    v_break_minutes:=coalesce(nullif(p_payload#>>'{shift,breakMinutes}','')::integer,coalesce((v_request.payload->>'breakMinutes')::integer,0));

    if v_decision='accepted' then
      if v_end<=v_start or v_break_minutes<0 or v_break_minutes>180
         or extract(epoch from (v_end-v_start))/60-v_break_minutes<=0
         or extract(epoch from (v_end-v_start))/60-v_break_minutes>720 then
        raise exception using errcode='22023',message='Schichtzeit oder Pause ist ungültig.';
      end if;

      v_rule_evaluation:=public.aora_evaluate_shift_rules(
        v_session.organization_id,
        v_request.employee_id,
        v_location_id,
        v_date,
        v_start,
        v_end,
        v_break_minutes,
        coalesce(v_state->'shifts','[]'::jsonb),
        null,
        null,
        v_access_role,
        v_session.subject_id
      );
      if not coalesce((v_rule_evaluation->>'valid')::boolean,false) then
        raise exception using errcode='22023',message=case
          when coalesce((v_rule_evaluation->>'requiresConfirmation')::boolean,false)
            then 'Bestätigung einer Arbeitszeitregel ist erforderlich.'
          else 'Der Schichtwunsch verletzt eine blockierende Arbeitszeitregel.'
        end;
      end if;

      if exists(
        select 1 from public.shifts shift
        where shift.organization_id=v_session.organization_id
          and shift.employee_id=v_request.employee_id
          and shift.shift_date=v_date
          and coalesce(shift.status,'draft')<>'cancelled'
          and shift.deleted_at is null
          and v_start<shift.ends_at
          and v_end>shift.starts_at
      ) then
        raise exception using errcode='40001',message='Die Schicht überschneidet sich mit einer bestehenden Schicht.';
      end if;

      v_shift_id:='shift_'||replace(gen_random_uuid()::text,'-','');
      v_shift_json:=jsonb_build_object(
        'id',v_shift_id,
        'employeeId',v_request.employee_id,
        'locationId',v_location_id,
        'date',v_date::text,
        'start',to_char(v_start,'HH24:MI'),
        'end',to_char(v_end,'HH24:MI'),
        'breakMinutes',v_break_minutes,
        'status','draft',
        'source','employee_preference',
        'sourcePreferenceId',v_request.id,
        'ruleSetId',v_rule_evaluation->>'ruleSetId',
        'ruleSetVersion',v_rule_evaluation->'ruleSetVersion',
        'ruleEvaluationId',v_rule_evaluation->>'evaluationId',
        'ruleOverrides','[]'::jsonb,
        'version',1,
        'publishedAt',null,
        'createdAt',v_now,
        'createdBy',v_session.subject_id,
        'updatedAt',v_now,
        'updatedBy',v_session.subject_id
      );

      insert into public.shifts(
        organization_id,id,employee_id,location_id,shift_date,status,payload,
        starts_at,ends_at,break_minutes,version,created_by,updated_by,created_at,updated_at
      ) values(
        v_session.organization_id,v_shift_id,v_request.employee_id,v_location_id,v_date,
        'draft',v_shift_json,v_start,v_end,v_break_minutes,1,v_session.subject_id,
        v_session.subject_id,v_now,v_now
      );

      v_state:=jsonb_set(v_state,'{shifts}',coalesce(v_state->'shifts','[]'::jsonb)||jsonb_build_array(v_shift_json),true);
      v_event_type:='SHIFT_PREFERENCE_ACCEPTED';
    else
      v_event_type:='SHIFT_PREFERENCE_REJECTED';
    end if;

    v_request_json:=v_request.payload||jsonb_build_object(
      'shiftId',v_shift_id,
      'resultingShiftId',v_shift_id,
      'status',v_decision,
      'reason',v_reason,
      'decidedAt',v_now,
      'decidedBy',v_session.subject_id,
      'updatedAt',v_now
    );

    update public.shift_requests
    set shift_id=v_shift_id,status=v_decision,reason=v_reason,decided_at=v_now,
        decided_by=v_session.subject_id,updated_at=v_now,payload=v_request_json
    where organization_id=v_session.organization_id and id=v_request.id;

    v_state:=jsonb_set(v_state,'{shiftRequests}',coalesce((
      select jsonb_agg(case when item->>'id'=v_request.id then v_request_json else item end)
      from jsonb_array_elements(coalesce(v_state->'shiftRequests','[]'::jsonb)) item
    ),'[]'::jsonb),true);

    v_notification_id:='note_'||replace(gen_random_uuid()::text,'-','');
    v_notification:=jsonb_build_object(
      'id',v_notification_id,
      'employeeId',v_request.employee_id,
      'locationId',v_location_id,
      'type','shift_preference_decision',
      'title',case when v_decision='accepted' then 'Schichtwunsch übernommen' else 'Schichtwunsch abgelehnt' end,
      'body',v_date::text||' · '||to_char(v_start,'HH24:MI')||'–'||to_char(v_end,'HH24:MI')||case when v_reason<>'' then ' · '||v_reason else '' end,
      'relatedEntityType','shift_request',
      'relatedEntityId',v_request.id,
      'read',false,
      'createdAt',v_now,
      'idempotencyKey','shift-preference:'||v_request.id||':'||v_decision
    );
    v_state:=jsonb_set(v_state,'{notifications}',coalesce(v_state->'notifications','[]'::jsonb)||jsonb_build_array(v_notification),true);
    insert into public.notifications(
      organization_id,id,employee_id,read,created_at,payload,location_id,type,title,body,
      related_entity_type,related_entity_id,idempotency_key
    ) values(
      v_session.organization_id,v_notification_id,v_request.employee_id,false,v_now,v_notification,v_location_id,
      'shift_preference_decision',v_notification->>'title',v_notification->>'body','shift_request',v_request.id,
      'shift-preference:'||v_request.id||':'||v_decision
    ) on conflict(organization_id,id) do nothing;

    v_audit_id:='audit_'||replace(gen_random_uuid()::text,'-','');
    v_audit:=jsonb_build_object(
      'id',v_audit_id,
      'action',v_event_type,
      'actor',v_session.subject_id,
      'actorType','admin',
      'actorId',v_session.subject_id,
      'entity','shift_request',
      'entityType','shift_request',
      'entityId',v_request.id,
      'createdAt',v_now,
      'payload',jsonb_build_object('shiftId',v_shift_id,'employeeId',v_request.employee_id,'reason',v_reason),
      'metadata',jsonb_build_object('locationId',v_location_id,'ruleEvaluationId',v_rule_evaluation->>'evaluationId')
    );
    v_state:=jsonb_set(v_state,'{audit}',coalesce(v_state->'audit','[]'::jsonb)||jsonb_build_array(v_audit),true);
    insert into public.audit_logs(
      organization_id,id,action,actor,entity,entity_id,created_at,payload,location_id,actor_type,actor_id,entity_type,metadata
    ) values(
      v_session.organization_id,v_audit_id,v_event_type,v_session.subject_id,'shift_request',v_request.id,v_now,
      jsonb_build_object('shiftId',v_shift_id,'employeeId',v_request.employee_id,'reason',v_reason),
      v_location_id,'admin',v_session.subject_id,'shift_request',
      jsonb_build_object('requestType','shift_preference','ruleEvaluationId',v_rule_evaluation->>'evaluationId')
    );
  end if;

  v_state:=jsonb_set(v_state,'{meta}',coalesce(v_state->'meta','{}'::jsonb)||jsonb_build_object(
    'revision',v_revision+1,'updatedAt',v_now,'variant','isolated-v8-final'
  ),true);

  v_next_revision:=public.aora_commit_workspace_state(
    v_session.organization_id,
    v_revision,
    v_state,
    v_access_role,
    v_session.subject_id,
    v_event_type,
    jsonb_build_object(
      'requestId',coalesce(v_request_id,p_request_id),
      'shiftId',v_shift_id,
      'employeeId',coalesce(v_request.employee_id,v_session.subject_id),
      'locationId',v_location_id,
      'action',p_action
    ),
    'shift_request',
    coalesce(v_request_id,p_request_id),
    v_location_id
  );

  v_response:=jsonb_build_object(
    'requestId',coalesce(v_request_id,p_request_id),
    'resultingShiftId',v_shift_id,
    'revision',v_next_revision,
    'ruleEvaluation',v_rule_evaluation,
    'serverTime',v_now
  );

  update public.idempotency_records
  set status='completed',response=v_response,updated_at=v_now
  where organization_id=v_session.organization_id
    and action=v_action_key
    and actor_id=v_session.subject_id
    and idempotency_key=p_idempotency_key;

  return v_response;
exception when others then
  if v_session.organization_id is not null and p_idempotency_key is not null then
    update public.idempotency_records
    set status='failed',error=sqlerrm,updated_at=clock_timestamp()
    where organization_id=v_session.organization_id
      and action=coalesce(v_action_key,'shift_preference_'||coalesce(p_action,'unknown'))
      and actor_id=v_session.subject_id
      and idempotency_key=p_idempotency_key;
  end if;
  raise;
end;
$function$;

revoke all on function public.aora_shift_preference_action(text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.aora_shift_preference_action(text,text,text,jsonb,uuid) to service_role;

commit;
