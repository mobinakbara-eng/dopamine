# Supabase Source of Truth

This directory will contain everything required to reproduce the Aora backend from Git.

```text
supabase/
  config.toml
  migrations/
  functions/
    _shared/
    access/
    workspace/
    kiosk/
    integrations/
  seed/
  tests/
    rls/
    contracts/
    migrations/
```

## Rules

1. Dashboard-only schema or function changes are temporary incidents and must be pulled into Git immediately.
2. Every DDL change is a reviewed migration.
3. Every exposed tenant table has reviewed grants and RLS.
4. Service-only tables are explicitly documented and denied to browser roles.
5. Edge Functions are versioned here with pinned dependencies and shared request/auth/error utilities.
6. Production functions are not used as temporary artifact storage, smoke-test runners or bootstrap scripts.
7. Seeds contain deterministic synthetic data only.
8. Generated TypeScript database types are refreshed after schema changes.
9. Security and performance advisors are reviewed after DDL changes.
10. Production migration execution requires a tested non-production result and a release/repair plan.

## Current recovery work

Before new backend implementation, recover from the connected project:

- all migrations in chronological order
- active Edge Function source and deployment settings
- RLS policies, grants, functions, triggers and storage policies
- environment variable names and ownership
- storage bucket configuration
- scheduled jobs and external integrations

Classify functions as:

- required production runtime
- migration compatibility
- internal operations
- obsolete/test/bootstrap

Do not disable or delete a function until call sites and logs confirm it is unused.

## Target runtime boundaries

- human access: Supabase Auth plus membership/RLS
- kiosk access: reviewed custom device trust flow
- application mutations: typed server boundary with idempotency and audit context
- integrations: versioned adapters and outbox processing
- direct browser table access: limited to intentionally exposed, RLS-protected read/write paths

## Legacy compatibility

The existing `workspace_snapshots` and projection functions remain available during migration. New modules must not create uncontrolled dual writes. Any temporary dual-write phase requires idempotency, parity queries, drift alerts and a named rollback path.