create or replace function public.aora_inventory_read_overview(
  p_organization_id uuid,
  p_location_id text
)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'locationId',p_location_id,
    'itemCount',(
      select count(*)
      from public.inventory_balances b
      where b.organization_id=p_organization_id
        and b.location_id=p_location_id
    ),
    'lowStockCount',(
      select count(*)
      from public.inventory_balances b
      left join public.inventory_item_locations il
        on il.organization_id=b.organization_id
       and il.location_id=b.location_id
       and il.item_id=b.item_id
       and il.active=true
      where b.organization_id=p_organization_id
        and b.location_id=p_location_id
        and b.on_hand<=coalesce(il.reorder_point,0)
    ),
    'openOrderCount',(
      select count(*)
      from public.inventory_purchase_orders po
      where po.organization_id=p_organization_id
        and po.location_id=p_location_id
        and po.status in ('draft','ready','sending','submitted','placed','delivered','partially_received')
    ),
    'inTransitCount',(
      select count(*)
      from public.inventory_transfers t
      where t.organization_id=p_organization_id
        and t.status='dispatched'
        and (t.source_location_id=p_location_id or t.destination_location_id=p_location_id)
    ),
    'pendingPrintCount',(
      select coalesce(sum(j.label_count),0)
      from public.inventory_label_print_jobs j
      where j.organization_id=p_organization_id
        and j.location_id=p_location_id
        and j.status in ('pending','prepared')
    ),
    'pendingPrintJobCount',(
      select count(*)
      from public.inventory_label_print_jobs j
      where j.organization_id=p_organization_id
        and j.location_id=p_location_id
        and j.status in ('pending','prepared')
    ),
    'updatedAt',clock_timestamp()
  );
$$;

revoke all on function public.aora_inventory_read_overview(uuid,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_read_overview(uuid,text) to service_role;
