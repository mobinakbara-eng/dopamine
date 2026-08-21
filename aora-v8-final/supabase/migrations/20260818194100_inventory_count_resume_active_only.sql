begin;

-- Review-state counts are intentionally not auto-resumed because count-line writes
-- are only valid while status=counting. Legacy review sessions remain untouched.
create or replace function public.aora_inventory_start_count(
  p_organization_id uuid,
  p_location_id text,
  p_scope text,
  p_actor_id text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_id uuid:=gen_random_uuid();
  v_existing public.inventory_counts%rowtype;
  v_rows int;
begin
  perform 1
    from public.locations
   where organization_id=p_organization_id
     and id=p_location_id
     and active=true
     and deleted_at is null;
  if not found then
    raise exception using errcode='P0002',message='inventory_location_not_found';
  end if;

  select * into v_existing
    from public.inventory_counts
   where organization_id=p_organization_id
     and location_id=p_location_id
     and status='counting'
   order by created_at desc
   limit 1;

  if found then
    select count(*) into v_rows
      from public.inventory_count_lines
     where organization_id=p_organization_id
       and count_id=v_existing.id;
    return jsonb_build_object(
      'countId',v_existing.id,
      'status',v_existing.status,
      'lineCount',v_rows,
      'version',v_existing.version,
      'resumed',true
    );
  end if;

  insert into public.inventory_counts(
    organization_id,id,location_id,status,scope,created_by
  ) values (
    p_organization_id,v_id,p_location_id,'counting',
    left(coalesce(nullif(trim(p_scope),''),'all'),80),p_actor_id
  );

  insert into public.inventory_count_lines(
    organization_id,count_id,item_id,system_quantity
  )
  select organization_id,v_id,item_id,on_hand
    from public.inventory_balances
   where organization_id=p_organization_id
     and location_id=p_location_id
   order by item_id;
  get diagnostics v_rows=row_count;

  return jsonb_build_object(
    'countId',v_id,
    'status','counting',
    'lineCount',v_rows,
    'version',1,
    'resumed',false
  );
end $$;

revoke all on function public.aora_inventory_start_count(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_start_count(uuid,text,text,text) to service_role;

commit;
