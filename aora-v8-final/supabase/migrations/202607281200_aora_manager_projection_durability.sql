-- Keep valid manager scopes available while snapshots are projected.
-- Existing rows are removed only when their manager/location pair is no
-- longer present in the authoritative snapshot.
create or replace function public.aora_sync_manager_location_access(
  p_organization_id uuid,
  p_state jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer;
begin
  delete from public.manager_location_access access_row
  where access_row.organization_id = p_organization_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_state->'admins','[]'::jsonb)) admin_item
      cross join lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(admin_item->'locationIds')='array' then admin_item->'locationIds'
          when nullif(admin_item->>'locationId','') is not null then jsonb_build_array(admin_item->>'locationId')
          else '[]'::jsonb
        end
      ) location_value
      where admin_item->>'scope'='manager'
        and coalesce(admin_item->>'active','true')<>'false'
        and coalesce(admin_item->>'status','active') not in ('revoked','suspended')
        and admin_item->>'id'=access_row.manager_id
        and location_value=access_row.location_id
    );

  insert into public.manager_location_access(
    organization_id, manager_id, membership_id, location_id, created_by
  )
  select
    p_organization_id,
    admin_item->>'id',
    membership.id,
    location_value,
    'snapshot-projection'
  from jsonb_array_elements(coalesce(p_state->'admins','[]'::jsonb)) admin_item
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(admin_item->'locationIds')='array' then admin_item->'locationIds'
      when nullif(admin_item->>'locationId','') is not null then jsonb_build_array(admin_item->>'locationId')
      else '[]'::jsonb
    end
  ) location_value
  join public.admins admin_row
    on admin_row.organization_id=p_organization_id
   and admin_row.id=admin_item->>'id'
  join public.locations location_row
    on location_row.organization_id=p_organization_id
   and location_row.id=location_value
  left join public.organization_memberships membership
    on membership.organization_id=p_organization_id
   and membership.admin_id=admin_item->>'id'
   and membership.status='active'
  where admin_item->>'scope'='manager'
    and coalesce(admin_item->>'active','true')<>'false'
    and coalesce(admin_item->>'status','active') not in ('revoked','suspended')
  on conflict(organization_id,manager_id,location_id) do update
  set membership_id=excluded.membership_id,
      created_at=clock_timestamp(),
      created_by=excluded.created_by;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.aora_sync_manager_location_access(uuid,jsonb)
from public, anon, authenticated;
grant execute on function public.aora_sync_manager_location_access(uuid,jsonb)
to service_role;


