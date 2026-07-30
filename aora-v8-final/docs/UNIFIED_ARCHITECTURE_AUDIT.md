# Aora Unified Architecture Audit

## Current production architecture

Aora is a framework-free modular SPA built from `aora-v8-final/app/`. The routes `/inhaber/`, `/arbeitgeber/`, `/arbeitnehmer/`, and `/kiosk/dashboard/` are generated from one HTML entrypoint. Authentication uses Aora app sessions stored in `app_sessions`; browser clients do not use Supabase Auth JWTs for domain authorization.

The existing Access, Workspace, Kiosk, Compliance, Monitoring, Onboarding and Realtime Edge Functions use the service role after validating an Aora session token. Existing operational writes still flow through a versioned `workspace_snapshots` document. Relational projection tables already exist for organizations, locations, employees, shifts, time entries, leave, kiosk and audit data.

## Compatibility constraints

1. The encrypted Kiosk offline queue and stable `event_id` replay contract must remain unchanged.
2. Existing invitation, owner, manager and employee sessions must continue to work.
3. Frontend deployment must never seed, reset or migrate tenant data.
4. Snapshot writes cannot be removed until relational verification and two stable releases are complete.
5. Direct browser access to canonical tables remains denied. Domain authorization is enforced by Edge Functions and transactional RPCs because current app sessions are not Supabase Auth JWTs.
6. Every domain query must include `organization_id`; location and employee scope are additionally enforced where applicable.

## Canonical source decision

`aora-v8-final/app/` remains the only buildable frontend source. New capabilities are added as modules under `app/modules/` and styles under `app/`. Legacy trees remain archived and are not read by the build.

Backend source lives under `aora-v8-final/supabase/functions/` and schema changes under `aora-v8-final/supabase/migrations/`.

## Target transition

The transition is additive:

`Legacy Snapshot -> Compatibility Workspace API -> Canonical Domain API -> Relational Tables`

New Calendar, Schedule Board, Open Shift, Task, Push and Clock-out Gate capabilities read and write relational tables through `aora-v8-domain-api`. Existing screens keep the compatibility API until each feature flag is enabled.

## Environment matrix

| Environment | Backend | Workspace/data | Purpose |
|---|---|---|---|
| local | explicit local variables | local/fixture tenant | development |
| staging/preview | `xqgkawskftzurbujrpex` | isolated QA tenants | migrations, E2E and destructive test cleanup |
| production | `lxpmgnllgqdulfjxbdau` | `aora-workforce` | controlled rollout only |

Production builds fail if the staging project ref is present.

## Rollout flags

- `canonical_database`
- `calendar_v2`
- `schedule_board_v2`
- `open_shift_marketplace`
- `task_automation`
- `clockout_task_gate`
- `web_push`

Flags are evaluated server-side and can be scoped to organization, location, role, employee or rollout percentage.

## Data safety

All schema work is additive. Soft-delete metadata is added to business records. Backfill is idempotent and records verification counts. Snapshot remains available for compatibility and backup. Production cutover requires a verified backup, migration verification, preview E2E, staging E2E and a production smoke test.
