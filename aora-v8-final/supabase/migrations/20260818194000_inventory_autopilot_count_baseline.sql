begin;

-- AORA Inventory Autopilot: a physical count is anchored when the line is
-- actually counted, not when a potentially long-running count session starts.
alter table public.inventory_count_lines
  add column if not exists baseline_version integer,
  add column if not exists baseline_captured_at timestamptz;

alter table public.inventory_count_lines
  drop constraint if exists inventory_count_lines_baseline_version_check;
alter table public.inventory_count_lines
  add constraint inventory_count_lines_baseline_version_check
  check (baseline_version is null or baseline_version > 0);

create index if not exists inventory_count_lines_unbaselined_idx
  on public.inventory_count_lines(organization_id,count_id,item_id)
  where baseline_version is null;

-- Reopening "Bestand zählen" resumes the latest open count instead of creating
-- overlapping whole-location counts. Existing legacy open counts are kept; their
-- lines must be physically recounted because baseline_version remains NULL.
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
     and status in ('counting','review')
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

  -- system_quantity is only a compatibility placeholder until the first physical
  -- save of each line. aora_inventory_set_count_line replaces it atomically.
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

-- The first physical save captures the live ledger balance and balance version in
-- the same transaction as the counted value. Later edits keep that baseline so
-- movements after the physical count remain valid when the variance is posted.
create or replace function public.aora_inventory_set_count_line(
  p_organization_id uuid,
  p_count_id uuid,
  p_item_id uuid,
  p_counted_quantity numeric,
  p_actor_id text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line public.inventory_count_lines%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_captured boolean:=false;
begin
  if p_counted_quantity is null or p_counted_quantity < 0 or p_counted_quantity > 1000000000 then
    raise exception using errcode='22023',message='inventory_count_quantity_invalid';
  end if;

  select * into v_count
    from public.inventory_counts
   where organization_id=p_organization_id
     and id=p_count_id
   for update;
  if not found then
    raise exception using errcode='P0002',message='inventory_count_not_found';
  end if;
  if v_count.status <> 'counting' then
    raise exception using errcode='P0001',message='inventory_count_state_invalid';
  end if;

  select * into v_line
    from public.inventory_count_lines
   where organization_id=p_organization_id
     and count_id=p_count_id
     and item_id=p_item_id
   for update;
  if not found then
    raise exception using errcode='P0002',message='inventory_count_line_not_found';
  end if;

  if v_line.baseline_version is null then
    select * into v_balance
      from public.inventory_balances
     where organization_id=p_organization_id
       and location_id=v_count.location_id
       and item_id=p_item_id
     for update;
    if not found then
      raise exception using errcode='P0002',message='inventory_balance_not_found';
    end if;

    update public.inventory_count_lines
       set system_quantity=v_balance.on_hand,
           baseline_version=v_balance.version,
           baseline_captured_at=clock_timestamp(),
           counted_quantity=p_counted_quantity,
           updated_by=p_actor_id,
           updated_at=clock_timestamp()
     where organization_id=p_organization_id
       and count_id=p_count_id
       and item_id=p_item_id
     returning * into v_line;
    v_captured:=true;
  else
    update public.inventory_count_lines
       set counted_quantity=p_counted_quantity,
           updated_by=p_actor_id,
           updated_at=clock_timestamp()
     where organization_id=p_organization_id
       and count_id=p_count_id
       and item_id=p_item_id
     returning * into v_line;
  end if;

  return jsonb_build_object(
    'countId',p_count_id,
    'itemId',p_item_id,
    'countedQuantity',v_line.counted_quantity,
    'baselineQuantity',v_line.system_quantity,
    'baselineVersion',v_line.baseline_version,
    'baselineCapturedAt',v_line.baseline_captured_at,
    'variance',v_line.variance,
    'baselineCaptured',v_captured
  );
end $$;

create or replace function public.aora_inventory_post_count(
  p_organization_id uuid,
  p_count_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line record;
  v_result jsonb;
  v_posted int:=0;
begin
  if p_actor_role not in('owner','manager') then
    raise exception using errcode='42501',message='inventory_count_actor_forbidden';
  end if;

  select * into v_count
    from public.inventory_counts
   where organization_id=p_organization_id
     and id=p_count_id
   for update;
  if not found then
    raise exception using errcode='P0002',message='inventory_count_not_found';
  end if;
  if v_count.status='posted' then
    return jsonb_build_object('countId',p_count_id,'status','posted','idempotent',true);
  end if;
  if v_count.status not in('counting','review') or v_count.version<>p_expected_version then
    raise exception using errcode='40001',message='inventory_count_conflict';
  end if;
  if exists(
    select 1 from public.inventory_count_lines
     where organization_id=p_organization_id
       and count_id=p_count_id
       and counted_quantity is null
  ) then
    raise exception using errcode='22023',message='inventory_count_incomplete';
  end if;
  if exists(
    select 1 from public.inventory_count_lines
     where organization_id=p_organization_id
       and count_id=p_count_id
       and baseline_version is null
  ) then
    raise exception using errcode='22023',message='inventory_count_baseline_required';
  end if;

  for v_line in
    select *
      from public.inventory_count_lines
     where organization_id=p_organization_id
       and count_id=p_count_id
     order by item_id
  loop
    if v_line.variance<>0 then
      v_result:=public.aora_inventory_apply_movement(
        p_organization_id,
        v_count.location_id,
        v_line.item_id,
        case when v_line.variance>0 then 'adjustment_in' else 'adjustment_out' end,
        abs(v_line.variance),
        'inventory_count',
        'inventory_count',
        p_count_id::text,
        p_actor_id,
        p_actor_role,
        'inventory-count:'||p_count_id::text||':'||v_line.item_id::text
      );
      v_posted:=v_posted+1;
    end if;
  end loop;

  update public.inventory_counts
     set status='posted',
         version=version+1,
         posted_by=p_actor_id,
         posted_at=clock_timestamp(),
         updated_at=clock_timestamp()
   where organization_id=p_organization_id
     and id=p_count_id;

  return jsonb_build_object(
    'countId',p_count_id,
    'status','posted',
    'adjustments',v_posted,
    'version',v_count.version+1,
    'idempotent',false
  );
end $$;

revoke all on function public.aora_inventory_set_count_line(uuid,uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_set_count_line(uuid,uuid,uuid,numeric,text) to service_role;

-- Reassert the existing restricted execution surface after replacing functions.
revoke all on function public.aora_inventory_start_count(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.aora_inventory_post_count(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.aora_inventory_start_count(uuid,text,text,text) to service_role;
grant execute on function public.aora_inventory_post_count(uuid,uuid,text,text,integer) to service_role;

commit;
