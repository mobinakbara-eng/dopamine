begin;

create table if not exists public.inventory_product_creation_requests (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  idempotency_key text not null,
  result jsonb not null,
  created_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,idempotency_key),
  check (length(idempotency_key) between 8 and 160)
);

alter table public.inventory_product_creation_requests enable row level security;
revoke all on table public.inventory_product_creation_requests from public,anon,authenticated;
grant all on table public.inventory_product_creation_requests to service_role;

create or replace function public.aora_inventory_create_product_bundle(
  p_organization_id uuid,p_location_id text,p_sku text,p_barcode text,p_name text,
  p_base_uom text,p_category text,p_reorder_point numeric,p_pack_code text,p_pack_label text,
  p_pack_base_quantity numeric,p_is_stock_unit boolean,p_is_order_unit boolean,p_supplier_id uuid,
  p_supplier_sku text,p_unit_price numeric,p_currency text,p_minimum_order_quantity numeric,
  p_order_multiple numeric,p_actor_id text,p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_pack_id uuid:=gen_random_uuid();
  v_supplier_item_id uuid;
  v_result jsonb;
begin
  if length(trim(coalesce(p_idempotency_key,''))) not between 8 and 160 then
    raise exception using errcode='22023',message='inventory_idempotency_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_idempotency_key,0));
  select result into v_result from public.inventory_product_creation_requests
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return v_result||jsonb_build_object('idempotent',true); end if;
  if nullif(trim(coalesce(p_pack_code,'')),'') is null or nullif(trim(coalesce(p_pack_label,'')),'') is null or coalesce(p_pack_base_quantity,0)<=0 then
    raise exception using errcode='22023',message='inventory_pack_unit_invalid';
  end if;
  if coalesce(p_minimum_order_quantity,0)<=0 or coalesce(p_order_multiple,0)<=0 then
    raise exception using errcode='22023',message='supplier_order_rules_invalid';
  end if;
  if p_unit_price is not null and p_unit_price<0 then raise exception using errcode='22023',message='supplier_price_invalid'; end if;
  if upper(trim(coalesce(p_currency,''))) !~ '^[A-Z]{3}$' then raise exception using errcode='22023',message='supplier_currency_invalid'; end if;

  v_item:=public.aora_inventory_create_item(p_organization_id,p_location_id,p_sku,p_barcode,p_name,p_base_uom,p_category,p_reorder_point,p_actor_id);
  v_item_id:=(v_item->>'itemId')::uuid;
  insert into public.inventory_pack_units(organization_id,id,item_id,code,label,base_quantity,is_stock_unit,is_order_unit)
  values(p_organization_id,v_pack_id,v_item_id,upper(left(trim(p_pack_code),40)),left(trim(p_pack_label),100),p_pack_base_quantity,coalesce(p_is_stock_unit,false),coalesce(p_is_order_unit,false));

  if p_supplier_id is not null then
    v_supplier_item_id:=gen_random_uuid();
    insert into public.inventory_supplier_items(organization_id,id,supplier_id,item_id,pack_unit_id,supplier_sku,supplier_item_name,unit_price,currency,minimum_order_quantity,order_multiple,created_by,updated_by)
    values(p_organization_id,v_supplier_item_id,p_supplier_id,v_item_id,v_pack_id,left(trim(coalesce(p_supplier_sku,'')),120),left(trim(p_name),180),p_unit_price,upper(trim(p_currency)),p_minimum_order_quantity,p_order_multiple,p_actor_id,p_actor_id);
  end if;

  v_result:=jsonb_build_object('itemId',v_item_id,'packUnitId',v_pack_id,'supplierItemId',v_supplier_item_id,'locationId',p_location_id,'version',1,'idempotent',false);
  insert into public.inventory_product_creation_requests(organization_id,idempotency_key,result,created_by)
  values(p_organization_id,p_idempotency_key,v_result,p_actor_id);
  return v_result;
end $$;

revoke all on function public.aora_inventory_create_product_bundle(uuid,text,text,text,text,text,text,numeric,text,text,numeric,boolean,boolean,uuid,text,numeric,text,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.aora_inventory_create_product_bundle(uuid,text,text,text,text,text,text,numeric,text,text,numeric,boolean,boolean,uuid,text,numeric,text,numeric,numeric,text,text) to service_role;

commit;
