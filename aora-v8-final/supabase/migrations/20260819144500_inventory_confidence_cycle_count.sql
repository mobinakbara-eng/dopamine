begin;

create or replace function public.aora_inventory_start_count_items(
  p_organization_id uuid,
  p_location_id text,
  p_item_ids uuid[],
  p_scope text,
  p_actor_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_id uuid:=gen_random_uuid();
  v_existing public.inventory_counts%rowtype;
  v_ids uuid[];
  v_requested integer;
  v_valid integer;
  v_rows integer;
begin
  perform 1 from public.locations
   where organization_id=p_organization_id and id=p_location_id and active=true and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='inventory_location_not_found'; end if;

  select coalesce(array_agg(distinct x order by x),'{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_item_ids,'{}'::uuid[])) x;
  v_requested:=coalesce(cardinality(v_ids),0);
  if v_requested<1 or v_requested>100 then
    raise exception using errcode='22023',message='inventory_count_item_scope_invalid';
  end if;

  select * into v_existing
    from public.inventory_counts
   where organization_id=p_organization_id and location_id=p_location_id and status='counting'
   order by created_at desc limit 1;
  if found then
    select count(*) into v_rows from public.inventory_count_lines
     where organization_id=p_organization_id and count_id=v_existing.id;
    return jsonb_build_object(
      'countId',v_existing.id,'status',v_existing.status,'lineCount',v_rows,'version',v_existing.version,
      'scope',v_existing.scope,'resumed',true,'requestedLineCount',v_requested,
      'resumedDifferentScope',v_existing.scope<>left(coalesce(nullif(trim(p_scope),''),'targeted'),80)
    );
  end if;

  select count(*) into v_valid
    from public.inventory_balances b
    join public.inventory_item_locations il
      on il.organization_id=b.organization_id and il.location_id=b.location_id and il.item_id=b.item_id and il.active=true
   where b.organization_id=p_organization_id and b.location_id=p_location_id and b.item_id=any(v_ids);
  if v_valid<>v_requested then
    raise exception using errcode='22023',message='inventory_count_item_scope_invalid';
  end if;

  insert into public.inventory_counts(organization_id,id,location_id,status,scope,created_by)
  values(p_organization_id,v_id,p_location_id,'counting',left(coalesce(nullif(trim(p_scope),''),'targeted'),80),p_actor_id);

  insert into public.inventory_count_lines(organization_id,count_id,item_id,system_quantity)
  select b.organization_id,v_id,b.item_id,b.on_hand
    from public.inventory_balances b
   where b.organization_id=p_organization_id and b.location_id=p_location_id and b.item_id=any(v_ids)
   order by b.item_id;
  get diagnostics v_rows=row_count;
  if v_rows<>v_requested then raise exception using errcode='P0001',message='inventory_count_item_scope_invariant'; end if;

  return jsonb_build_object(
    'countId',v_id,'status','counting','lineCount',v_rows,'version',1,
    'scope',left(coalesce(nullif(trim(p_scope),''),'targeted'),80),'resumed',false,'requestedLineCount',v_requested
  );
end
$function$;

revoke all on function public.aora_inventory_start_count_items(uuid,text,uuid[],text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_start_count_items(uuid,text,uuid[],text,text) to service_role;

commit;
