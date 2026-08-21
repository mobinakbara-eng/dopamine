begin;

alter table public.inventory_count_lines
  add column if not exists client_counted_at timestamptz,
  add column if not exists baseline_reconstructed boolean not null default false;

create or replace function public.aora_inventory_set_count_line_at(
  p_organization_id uuid,
  p_count_id uuid,
  p_item_id uuid,
  p_counted_quantity numeric,
  p_actor_id text,
  p_counted_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line public.inventory_count_lines%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_at timestamptz:=coalesce(p_counted_at,clock_timestamp());
  v_after numeric(20,6):=0;
  v_after_count bigint:=0;
  v_baseline numeric(20,6);
  v_baseline_version bigint;
  v_reconstructed boolean:=p_counted_at is not null;
begin
  if p_counted_quantity is null or p_counted_quantity<0 or p_counted_quantity>1000000000 then
    raise exception using errcode='22023',message='inventory_count_quantity_invalid';
  end if;

  select * into v_count
    from public.inventory_counts
   where organization_id=p_organization_id and id=p_count_id
   for update;
  if not found then raise exception using errcode='P0002',message='inventory_count_not_found'; end if;
  if v_count.status<>'counting' then raise exception using errcode='P0001',message='inventory_count_state_invalid'; end if;

  if v_at < v_count.created_at-interval '2 minutes'
     or v_at > clock_timestamp()+interval '2 minutes'
     or v_at < clock_timestamp()-interval '7 days' then
    raise exception using errcode='22023',message='inventory_count_timestamp_invalid';
  end if;

  select * into v_line
    from public.inventory_count_lines
   where organization_id=p_organization_id and count_id=p_count_id and item_id=p_item_id
   for update;
  if not found then raise exception using errcode='P0002',message='inventory_count_line_not_found'; end if;

  if v_line.baseline_version is null then
    select * into v_balance
      from public.inventory_balances
     where organization_id=p_organization_id and location_id=v_count.location_id and item_id=p_item_id
     for update;
    if not found then raise exception using errcode='P0002',message='inventory_balance_not_found'; end if;

    select coalesce(sum(quantity_delta),0),count(*)
      into v_after,v_after_count
      from public.inventory_movements
     where organization_id=p_organization_id
       and location_id=v_count.location_id
       and item_id=p_item_id
       and occurred_at>v_at;

    v_baseline:=v_balance.on_hand-v_after;
    if v_baseline<0 then
      raise exception using errcode='P0001',message='inventory_count_history_invariant_failed';
    end if;
    v_baseline_version:=greatest(1,v_balance.version-v_after_count);

    update public.inventory_count_lines
       set system_quantity=v_baseline,
           baseline_version=v_baseline_version,
           baseline_captured_at=v_at,
           client_counted_at=p_counted_at,
           baseline_reconstructed=v_reconstructed,
           counted_quantity=p_counted_quantity,
           updated_by=p_actor_id,
           updated_at=clock_timestamp()
     where organization_id=p_organization_id and count_id=p_count_id and item_id=p_item_id
     returning * into v_line;
  else
    update public.inventory_count_lines
       set counted_quantity=p_counted_quantity,
           updated_by=p_actor_id,
           updated_at=clock_timestamp()
     where organization_id=p_organization_id and count_id=p_count_id and item_id=p_item_id
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
    'offlineReconstructed',v_line.baseline_reconstructed
  );
end $$;

create or replace function public.aora_inventory_set_count_line(
  p_organization_id uuid,
  p_count_id uuid,
  p_item_id uuid,
  p_counted_quantity numeric,
  p_actor_id text
) returns jsonb
language sql
security definer
set search_path=public,extensions,pg_temp
as $$
  select public.aora_inventory_set_count_line_at($1,$2,$3,$4,$5,null);
$$;

revoke all on function public.aora_inventory_set_count_line_at(uuid,uuid,uuid,numeric,text,timestamptz) from public,anon,authenticated;
revoke all on function public.aora_inventory_set_count_line(uuid,uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_set_count_line_at(uuid,uuid,uuid,numeric,text,timestamptz) to service_role;
grant execute on function public.aora_inventory_set_count_line(uuid,uuid,uuid,numeric,text) to service_role;

commit;
