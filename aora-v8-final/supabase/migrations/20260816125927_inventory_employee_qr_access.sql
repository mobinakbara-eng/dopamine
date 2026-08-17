-- Employee inventory access is deliberately narrower than the manager UI.
-- Grants are location-scoped and every change is appended to an audit trail.
create table if not exists public.inventory_permission_events (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  subject_type text not null check (subject_type in ('admin','employee')),
  subject_id text not null,
  location_id text not null,
  permission text not null,
  action text not null check (action in ('granted','revoked')),
  actor_id text not null,
  actor_role text not null check (actor_role in ('owner','manager','system')),
  occurred_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id) on delete restrict
);
create index if not exists inventory_permission_events_subject_idx
  on public.inventory_permission_events(organization_id,subject_type,subject_id,location_id,occurred_at desc);
alter table public.inventory_permission_events enable row level security;
revoke all on table public.inventory_permission_events from public,anon,authenticated;
grant all on table public.inventory_permission_events to service_role;

create or replace function public.aora_inventory_set_employee_scan_access(
  p_organization_id uuid,p_location_id text,p_employee_id text,p_enabled boolean,p_actor_id text,p_actor_role text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_employee public.employees%rowtype; v_has_location boolean; v_changed boolean:=false; v_rows integer:=0;
begin
  if p_actor_role not in ('owner','manager') then raise exception using errcode='42501',message='inventory_access_actor_forbidden'; end if;
  select * into v_employee from public.employees where organization_id=p_organization_id and id=p_employee_id and active=true and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='inventory_employee_not_found'; end if;
  v_has_location:=p_location_id=coalesce(v_employee.primary_location_id,v_employee.location_id)
    or p_location_id=v_employee.location_id
    or exists(select 1 from public.employee_location_access a where a.organization_id=p_organization_id and a.employee_id=p_employee_id and a.location_id=p_location_id);
  if not v_has_location then raise exception using errcode='42501',message='inventory_employee_location_forbidden'; end if;
  if p_enabled then
    insert into public.inventory_permission_grants(organization_id,subject_type,subject_id,location_id,permission,granted_by)
    values(p_organization_id,'employee',p_employee_id,p_location_id,'consume',p_actor_id) on conflict do nothing;
    get diagnostics v_rows=row_count; v_changed:=v_rows>0;
  else
    delete from public.inventory_permission_grants where organization_id=p_organization_id and subject_type='employee' and subject_id=p_employee_id and location_id=p_location_id and permission='consume';
    get diagnostics v_rows=row_count; v_changed:=v_rows>0;
  end if;
  if v_changed then
    insert into public.inventory_permission_events(organization_id,subject_type,subject_id,location_id,permission,action,actor_id,actor_role)
    values(p_organization_id,'employee',p_employee_id,p_location_id,'consume',case when p_enabled then 'granted' else 'revoked' end,p_actor_id,p_actor_role);
  end if;
  return jsonb_build_object('employeeId',p_employee_id,'locationId',p_location_id,'permission','consume','enabled',p_enabled,'changed',v_changed);
end $$;
revoke all on function public.aora_inventory_set_employee_scan_access(uuid,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_set_employee_scan_access(uuid,text,text,boolean,text,text) to service_role;
insert into public.feature_flags(organization_id,flag_key,enabled,config)
select id,'inventory_employee_scan',false,jsonb_build_object('rollout','off','schemaVersion',1)
from public.organizations
on conflict(organization_id,location_id,flag_key) do nothing;
