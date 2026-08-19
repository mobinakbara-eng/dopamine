---
name: aora-database-migration
description: Plan, implement and verify AORA database migrations with backward compatibility, existing-data safety, RLS awareness, rollback/recovery and staging evidence. Use for schema changes, indexes, constraints, policy migrations or data backfills.
---

# AORA Database Migration

Treat every migration as a release artifact, not just SQL.

## Required migration record
Capture:
- migration purpose and identifier
- affected tables, columns, indexes, constraints, triggers and policies
- expected row/data volume if known
- existing-data compatibility
- old-client/new-schema compatibility
- new-client/old-schema compatibility during rollout
- lock or long-running-operation risk
- backfill strategy and idempotency
- rollback or forward-fix strategy
- staging verification queries
- production verification queries

## Preferred evolution
Use expand -> backfill/migrate -> switch readers/writers -> verify -> contract. Avoid one-shot destructive replacements when a staged evolution is possible.

## Safety rules
- No `DROP`, `TRUNCATE`, broad policy removal or irreversible rewrite by default.
- Never assume an empty production table because staging is empty.
- RLS changes require `aora-tenancy-rbac` and `aora-security`.
- Re-runnable/backfill scripts need idempotency and progress visibility.
- A rollback that restores code but loses newly written user data is incomplete; define data recovery.

Classify production-sensitive migrations as R4 or R5 and require the corresponding release gate.
