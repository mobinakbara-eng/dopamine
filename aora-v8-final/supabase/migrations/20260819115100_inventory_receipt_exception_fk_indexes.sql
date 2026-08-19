begin;

create index if not exists inventory_receipt_exceptions_receipt_fk_idx
  on public.inventory_receipt_exceptions(organization_id,receipt_id);
create index if not exists inventory_receipt_exceptions_item_fk_idx
  on public.inventory_receipt_exceptions(organization_id,item_id);
create index if not exists inventory_receipt_exceptions_pack_fk_idx
  on public.inventory_receipt_exceptions(organization_id,pack_unit_id);

commit;
