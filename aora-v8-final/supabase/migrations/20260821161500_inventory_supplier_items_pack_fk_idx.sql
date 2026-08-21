begin;

-- Production rollout advisor hardening: cover the composite supplier-item pack-unit
-- foreign key without changing data or feature-flag state.
create index if not exists inventory_supplier_items_pack_fk_idx
  on public.inventory_supplier_items(organization_id,pack_unit_id)
  where pack_unit_id is not null;

commit;
