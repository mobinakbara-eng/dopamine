begin;
create index if not exists inventory_label_print_jobs_item_fk_idx on public.inventory_label_print_jobs(organization_id,item_id);
create index if not exists inventory_label_print_jobs_pack_fk_idx on public.inventory_label_print_jobs(organization_id,pack_unit_id);
create index if not exists inventory_label_print_jobs_order_fk_idx on public.inventory_label_print_jobs(organization_id,purchase_order_id) where purchase_order_id is not null;
commit;
