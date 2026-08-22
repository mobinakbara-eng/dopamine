begin;

-- Both indexes had the same columns and predicate. Keep the original
-- inventory_supplier_items_pack_unit_fk_idx and remove only its duplicate.
drop index if exists public.inventory_supplier_items_pack_fk_idx;

commit;
