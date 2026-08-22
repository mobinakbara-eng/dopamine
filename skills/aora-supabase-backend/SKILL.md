---
name: aora-supabase-backend
description: Design, inspect or modify AORA Supabase/Postgres schemas, migrations, RLS, Edge Functions and persistence workflows safely. Use for database, API, Edge Function, migration, realtime persistence or server-side validation work.
---

# AORA Supabase Backend

Treat database and Edge Function changes as stateful system changes.

## Before change
- inspect current schema/migrations/policies/functions
- identify existing data and backward compatibility
- identify workspace/location/identity/device scope
- identify callers in all affected roles
- classify risk; RLS/auth/production config is R4

## Migration discipline
Prefer additive/expand-first changes. Document affected tables/policies, lock/data impact, rollback/recovery and verification queries. Do not use destructive migration as a shortcut.

## Server boundary
Validate authorization and input server-side. Use durable constraints for durable invariants. Use idempotency keys/correlation where retry is normal. Avoid leaking service-role capability to browser code.

## Validation actors
When policies/tenancy are involved, test representative anonymous, employee A/B, manager location A/B, owner and kiosk device/location contexts as applicable.
