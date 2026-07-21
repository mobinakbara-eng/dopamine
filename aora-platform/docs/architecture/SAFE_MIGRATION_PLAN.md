# Safe Migration Plan

## Purpose

Modernize Aora without overwriting the current application, losing the latest Vercel bundle, or making irreversible changes to the Supabase production-like project.

## Current facts that shape the plan

- The GitHub `main` branch contains the legacy static frontend under `aora/`.
- The currently aliased Vercel production deployment contains a newer bundled application and has no Git source metadata.
- Supabase contains migrations and Edge Function versions that are not fully represented in GitHub.
- The active Supabase project is named staging but is serving the live application.

Therefore the first phase is source recovery and environment separation, not feature development.

## Safety invariants

- Never edit or delete `aora/` during foundation work.
- Never deploy this foundation branch to the production alias.
- Never run DDL against the current Supabase project before the migration is committed and tested elsewhere.
- Never replace the latest Vercel production deployment until its static output and configuration are recoverable.
- Every cutover has a tested rollback target.
- No hidden dashboard-only code or database change is accepted as complete.

## Phase 0 — Freeze and recover

### Deliverables

- Tag the current GitHub baseline.
- Record the current Vercel production deployment ID, aliases, environment configuration and rollback target.
- Export/recover the exact source or, at minimum, the complete built output of the Git-untracked production deployment.
- Export all active Supabase Edge Function source.
- Pull the complete migration history into `aora-platform/supabase/migrations`.
- Generate and commit database types.
- Create an inventory of active, obsolete, test and public Edge Functions.
- Document secrets by name and owner, never by value.

### Exit gate

A new engineer can reproduce the existing application behavior from committed assets or can restore the exact current production deployment without relying on undocumented local files.

## Phase 1 — Establish isolated environments

### Target environments

| Environment | Git source | Vercel | Supabase | Data |
|---|---|---|---|---|
| Local | feature branch | local | local Supabase | deterministic seed |
| Preview | pull request | unique preview URL | preview branch/project | synthetic only |
| Staging | `develop` or release branch | stable staging alias | dedicated staging | masked/synthetic |
| Production | protected `main` release | production alias | dedicated production | real |

A Supabase development branch may incur cost and must be created only after explicit cost confirmation. Until then, local Supabase or a separate approved non-production project is used.

### Exit gate

A pull request can be tested end to end without touching live data or the production alias.

## Phase 2 — Build the compatibility shell

Create the new `apps/web` and `apps/kiosk` shells with:

- typed environment configuration
- shared design tokens
- i18n from day one
- role-aware navigation
- error/loading/offline states
- observability hooks
- a typed legacy API adapter

The adapter initially calls the current access/workspace endpoints. No business logic is copied into React components.

### Exit gate

The new shell can authenticate against a non-production backend and display a read-only parity view for one role.

## Phase 3 — Move authentication

### Human accounts

- create real Supabase Auth identities
- map users to organization memberships
- implement invitation, recovery and MFA for privileged roles
- remove human reliance on public directory selection and shared PIN patterns

### Kiosk devices

- keep a separate device activation flow
- add rotation, revocation, replay defense and location binding

### Exit gate

All roles pass positive and negative authorization tests, including cross-tenant and cross-location denial tests.

## Phase 4 — Migrate bounded contexts

Recommended order:

1. identity, tenancy and settings
2. people, locations and contracts
3. scheduling and availability
4. time and attendance
5. leave and corrections
6. tasks/checklists/evidence
7. timesheets/pay rules/export
8. communication and notifications
9. reporting and AI assistance

For each bounded context:

1. define canonical schema and API contract
2. add tests and migration
3. backfill or project data in non-production
4. run parity and reconciliation checks
5. enable read path behind a feature flag
6. enable write path for internal/test tenant
7. canary to selected tenant/location
8. monitor and retain rollback
9. retire the legacy path only after the observation window

## Phase 5 — Product and compliance readiness

- WCAG 2.2 AA verification
- German and English complete translations
- timezone and locale tests
- privacy export/deletion/retention workflows
- audit and support access controls
- documented data-processing roles and subprocessors
- backup/restore and incident runbooks
- customer onboarding and tenant provisioning
- public status, support and release process

## Phase 6 — Controlled production cutover

- create production candidate from a Git commit
- deploy to preview and run all gates
- promote the validated deployment rather than rebuilding different code
- start with internal/demo tenant or a small traffic/tenant cohort
- compare error rate, latency, login success, data reconciliation and clock-flow success
- expand gradually
- keep the previous production deployment immediately rollbackable

## Rollback levels

1. **UI rollback:** repoint Vercel alias to previous deployment.
2. **Route rollback:** disable feature flag and return a module to legacy API/UI.
3. **API rollback:** deploy previous Edge Function version.
4. **Data rollback:** prefer forward repair; destructive rollback requires verified backup and an approved runbook.

## Change ownership

Every migration work item must name:

- product owner
- engineering owner
- data owner
- security reviewer
- rollback owner
- validation evidence

## Immediate next actions

1. Recover and commit the current Vercel production source/build.
2. Export current Supabase functions and migrations to Git.
3. Classify and disable obsolete public functions only after dependency verification.
4. Create local and approved preview environments.
5. Scaffold the new apps and shared packages.
6. Implement the legacy adapter and first read-only employee parity slice.