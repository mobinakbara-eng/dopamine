begin;

-- PostgreSQL now() is transaction-start time. Offline count reconstruction needs
-- the wall-clock moment each ledger event was actually inserted, otherwise a
-- later movement inside a long transaction can appear to predate a physical
-- count. clock_timestamp() preserves the intended temporal ordering.
alter table public.inventory_movements
  alter column occurred_at set default clock_timestamp();

commit;
