begin;

-- The original QR invariant allowed exactly one consumption/waste movement per
-- stock unit because a QR label represented an indivisible package. Partial
-- consumption intentionally creates multiple ledger rows for the same stock unit.
-- Concurrency safety now lives in the locked stock-unit remaining_quantity/status
-- plus the globally unique movement idempotency key, so the old partial unique
-- index would incorrectly reject the second valid partial withdrawal.
drop index if exists public.inventory_movements_stock_unit_issue_uidx;

create index if not exists inventory_movements_stock_unit_history_idx
  on public.inventory_movements(organization_id,stock_unit_id,occurred_at desc)
  where stock_unit_id is not null;

commit;
