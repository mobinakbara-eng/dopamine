begin;

alter table public.datev_hours_export_settings
  add column if not exists version bigint not null default 1 check (version>0);

alter table public.datev_hours_export_runs
  add column if not exists export_mode text not null default 'draft' check (export_mode in ('draft','final')),
  add column if not exists source_revision bigint,
  add column if not exists source_snapshot_hash text check (source_snapshot_hash is null or source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists config_version bigint check (config_version is null or config_version>0),
  add column if not exists idempotency_key text,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

create unique index if not exists datev_hours_export_runs_idempotency_idx
  on public.datev_hours_export_runs(organization_id,idempotency_key)
  where idempotency_key is not null;

create table if not exists public.datev_hours_config_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  version bigint not null check(version>0),
  changed_by text not null,
  settings jsonb not null,
  mapping_employee_ids text[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  unique(organization_id,version)
);
alter table public.datev_hours_config_audit enable row level security;
revoke all on table public.datev_hours_config_audit from public,anon,authenticated;
grant all on table public.datev_hours_config_audit to service_role;

create or replace function public.aora_datev_save_hours_config_atomic(
  p_organization_id uuid,p_expected_version bigint,p_berater_number text,p_mandant_number text,
  p_regular_wage_type text,p_mappings jsonb,p_actor_id text
) returns bigint
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_current bigint;
  v_next bigint;
  v_mapping jsonb;
  v_employee_id text;
  v_personnel_number text;
begin
  if p_berater_number !~ '^\d{4,7}$' or p_mandant_number !~ '^\d{1,5}$' or p_regular_wage_type !~ '^\d{1,4}$' then
    raise exception using errcode='22023',message='invalid_datev_config';
  end if;
  if jsonb_typeof(coalesce(p_mappings,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_mappings,'[]'::jsonb))>500 then
    raise exception using errcode='22023',message='invalid_datev_mappings';
  end if;
  select version into v_current from public.datev_hours_export_settings where organization_id=p_organization_id for update;
  v_current:=coalesce(v_current,0);
  if v_current<>coalesce(p_expected_version,0) then raise exception using errcode='40001',message='datev_config_version_conflict'; end if;
  v_next:=v_current+1;
  insert into public.datev_hours_export_settings(organization_id,target_system,berater_number,mandant_number,regular_wage_type,updated_by,updated_at,version)
  values(p_organization_id,'datev_lodas',p_berater_number,p_mandant_number,p_regular_wage_type,p_actor_id,clock_timestamp(),v_next)
  on conflict(organization_id) do update set berater_number=excluded.berater_number,mandant_number=excluded.mandant_number,regular_wage_type=excluded.regular_wage_type,updated_by=excluded.updated_by,updated_at=excluded.updated_at,version=excluded.version;
  for v_mapping in select value from jsonb_array_elements(coalesce(p_mappings,'[]'::jsonb)) loop
    v_employee_id:=nullif(trim(v_mapping->>'employeeId'),'');
    v_personnel_number:=nullif(trim(v_mapping->>'personnelNumber'),'');
    if v_employee_id is null then raise exception using errcode='22023',message='invalid_datev_employee'; end if;
    if v_personnel_number is null then
      delete from public.datev_hours_employee_mappings where organization_id=p_organization_id and employee_id=v_employee_id;
    else
      if v_personnel_number !~ '^\d{1,5}$' or v_personnel_number::integer not between 1 and 99999 then raise exception using errcode='22023',message='invalid_datev_personnel_number'; end if;
      insert into public.datev_hours_employee_mappings(organization_id,employee_id,personnel_number,updated_by,updated_at)
      values(p_organization_id,v_employee_id,v_personnel_number,p_actor_id,clock_timestamp())
      on conflict(organization_id,employee_id) do update set personnel_number=excluded.personnel_number,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
    end if;
  end loop;
  insert into public.datev_hours_config_audit(organization_id,version,changed_by,settings,mapping_employee_ids)
  values(p_organization_id,v_next,p_actor_id,jsonb_build_object('targetSystem','datev_lodas','beraterNumber',p_berater_number,'mandantNumber',p_mandant_number,'regularWageType',p_regular_wage_type),array(select value->>'employeeId' from jsonb_array_elements(coalesce(p_mappings,'[]'::jsonb))));
  return v_next;
exception when unique_violation then
  raise exception using errcode='23505',message='duplicate_datev_personnel_number';
end $$;

revoke all on function public.aora_datev_save_hours_config_atomic(uuid,bigint,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.aora_datev_save_hours_config_atomic(uuid,bigint,text,text,text,jsonb,text) to service_role;

commit;
