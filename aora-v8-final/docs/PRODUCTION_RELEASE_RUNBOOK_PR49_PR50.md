# AORA Production Release Runbook

**Release candidate:** PR #49 + PR #50  
**Target:** controlled AORA pilot at Einstein Kaffee am Tacheles  
**Status captured:** 2026-08-21, Europe/Berlin  
**Current decision:** **NO-GO until all blocking gates in section 4 are closed**

This is an operational release record, not authorization to merge or deploy. Any change to either recorded head SHA invalidates the corresponding evidence and requires the affected gates to run again.

Repository control observed at capture: `main` points to `b7f7fa009fce344ecc387564f965237aaba094fe` and GitHub reports `protected=false`, with no enforced required status checks. This is a release blocker, not a documentation warning.

## 1. Release objective

Ship a reversible, feature-flagged production candidate for the first AORA pilot without modifying protected Einstein Tacheles business data during preparation.

The release may contain:

- the existing workforce core: roles, shifts, kiosk time capture, time corrections, tasks, timesheet approval, payroll preparation and exports;
- the PR #49 inventory foundation, procurement, QR, scheduler and push hardening;
- the PR #50 Inventory Autopilot delta, but initially disabled for every production organization and location;
- manual supplier Email and WhatsApp fallbacks only.

The release must not contain or advertise:

- the DATEV direct-integration PR #52;
- DATEV partner, approval, certification or successful test-import claims;
- automatic supplier Email delivery until a real sender is configured and verified;
- WhatsApp Business Platform delivery until real credentials and an approved template flow exist;
- full payroll calculation, tax advice, legal advice, full accounting or E-Invoice functionality.

## 2. Immutable evidence snapshot

### PR #49 - inventory foundation and production hardening

- URL: https://github.com/mobinakbara-eng/dopamine/pull/49
- Base: `main` at `b7f7fa009fce344ecc387564f965237aaba094fe`
- Recorded head: `a073561efe2a7e5f13e83b2278d6192f0d52d159`
- State at capture: open, non-draft, mergeable, not merged
- Verified on the recorded head:
  - Aora Task Media Gate run 60: success
  - Aora Shared Shift Task Gate run 60: success
  - Aora Timesheet Approval E2E run 272: success
  - Aora V8 Pilot Gate run 439: success
  - Vercel deployment status: success
  - Netlify deploy preview status: success

Note: the PR description names an older test SHA. The release decision uses the GitHub checks attached to the current recorded head above, not the stale SHA in the description.

### PR #50 - Inventory Autopilot delta

- URL: https://github.com/mobinakbara-eng/dopamine/pull/50
- Base: PR #49 branch at `a073561efe2a7e5f13e83b2278d6192f0d52d159`
- Recorded head: `ebec778e419118e5e871da808b05d3bd6eb03062`
- Topology: 107 commits ahead of PR #49 head, 0 behind
- State at capture: open, draft, mergeable, not merged
- Verified on the recorded head:
  - Aora Inventory Autopilot Gate run 96: success
  - 100 independent authenticated sessions: success
  - read p95 7.331 s against an 8 s staging budget: success
  - write p95 4.527 s against a 12 s staging budget: success
  - 100/100 idempotent replays and zero final failures
  - Vercel deployment status: success

PR #50 currently targets the PR #49 branch. The general V8, Timesheet and Task Media workflows only trigger for pull requests targeting `main`, so their absence on the PR #50 head is expected but is not acceptable for final production approval. They must run on the final combined head after retargeting or by explicit `workflow_dispatch`.

### Explicitly excluded PR #52 - DATEV foundation

- URL: https://github.com/mobinakbara-eng/dopamine/pull/52
- Recorded head: `9061eed557ab96eb5e142d6c64b2cd0ea33a3428`
- Aora Timesheet Approval E2E run 308: failed
- Aora V8 Pilot Gate run 475: failed
- Decision: remain draft and excluded from this release. Its failures do not block the non-DATEV pilot only if none of its commits are present in the release commit.

## 3. Release architecture and safe default

### Inventory feature flags

All production inventory flags must remain disabled through database migration, Edge Function deployment and frontend deployment:

- `inventory_v1`
- `inventory_qr`
- `inventory_printing`
- `inventory_employee_scan`
- `replenishment_suggestions`
- `supplier_email`
- `supplier_whatsapp`
- `inventory_counting`

The migrations currently insert the inventory flags disabled. This state must be verified after migration and before any frontend is promoted.

First enablement is limited to the selected pilot organization and one Tacheles location. Organization-wide fallback rows and location-specific rows must be reviewed so a location-specific value cannot unexpectedly inherit an enabled global value.

### Deployment order

1. Backup and capture pre-release fingerprints.
2. Apply reviewed database migrations with all flags off.
3. Verify schema, RLS, grants, functions and protected-data fingerprints.
4. Deploy only the required production Edge Functions.
5. Run backend health and authorization smoke tests while flags remain off.
6. Deploy the immutable frontend artifact from the approved commit.
7. Run workforce regression smoke tests with inventory still off.
8. Enable `inventory_v1` for the single pilot location.
9. Enable secondary inventory flags one by one only after their previous stage is healthy.

Database deployment must precede code that depends on the new schema. User visibility must be controlled by server-side feature flags, not only hidden navigation.

## 4. Blocking Go/No-Go gates

The release is **NO-GO** while any item below is unchecked.

### A. Release identity and automation

- [ ] Freeze the final PR #49 and PR #50 head SHAs in the release record.
- [ ] Confirm that neither final head contains a commit from PR #52.
- [ ] Protect `main` before merging: require pull requests, block force pushes/deletion and do not allow routine admin bypass.
- [ ] Require successful latest-SHA checks for Aora V8 Pilot, Timesheet Approval E2E, Task Media and the applicable Inventory/Shared Task gates.
- [ ] Require one approval from someone other than the latest pusher and dismiss stale approval after code changes.
- [ ] Confirm the exact Vercel project, production branch, domains and team owner.
- [ ] Confirm whether a merge to `main` automatically promotes Vercel to production.
- [ ] Confirm whether Supabase GitHub Integration automatically applies migrations/functions from `main`.
- [ ] Disable uncontrolled automatic promotion or use an approved staged/rolling release path before the first merge.
- [ ] Record the last known-good Vercel production deployment URL/ID and prove the operator can invoke and verify rollback.
- [ ] Record the current production Supabase project ref in the private release evidence store. Never add it with secrets to this public document.

### B. Backup and recovery

- [ ] Verify a current Supabase daily backup or PITR recovery point immediately before migration.
- [ ] Produce a logical schema dump and a protected, encrypted data dump where permitted.
- [ ] Restore the backup into a temporary isolated project and record a successful restore test. A backup without a tested restore is insufficient.
- [ ] Record RPO, expected downtime and the person authorized to initiate restore.
- [ ] Capture row-count and integrity fingerprints for the protected Tacheles organization before migration.

### C. Final combined-head CI

- [x] PR #49 current-head general gates passed.
- [x] PR #50 current-head Inventory Autopilot gate passed.
- [ ] Retarget/rebase PR #50 onto the merged `main` without losing its exact delta.
- [ ] Aora V8 Pilot Gate passes on the final combined head.
- [ ] Aora Timesheet Approval E2E passes on the final combined head.
- [ ] Aora Task Media Gate passes on the final combined head.
- [ ] Aora Shared Shift Task Gate passes where its path rules require it.
- [ ] Aora Inventory Autopilot Gate passes on the final combined head.
- [ ] Vercel preview for the final combined head is Ready.
- [ ] One reviewer other than the latest pusher approves the final code and migration diff.

### D. Database migration rehearsal

- [ ] Run `supabase migration list` and resolve every local/remote history mismatch before deployment.
- [ ] Run `supabase db push --dry-run` against the linked production project and archive the exact migration list.
- [ ] Apply the same migration list to a restored copy of the current production schema/data.
- [ ] Run the full workforce, tenant-isolation, kiosk, timesheet and inventory tests on that copy.
- [ ] Set local migration session timeouts so a lock waits for a bounded time rather than blocking production indefinitely.
- [ ] Prove old workforce flows remain compatible with the migrated schema while inventory flags are off.
- [ ] Review the intentional constraint replacement used for partial QR history and document the forward-only recovery decision.
- [ ] Review migrations `20260821131500` through `20260821145000`: several contain staging/CI helper functions inside the normal migration directory. Approve their tightly gated presence in production or split them into a production-safe manifest before Go.
- [ ] Confirm the production deployment does not deploy `aora-v8-inventory-load-ci-bootstrap` or create a usable CI bootstrap route.
- [ ] Confirm no seed/test tenant, employee, session, stock, order or inventory record is created in production.

### E. Security and operational controls

- [ ] Enable Supabase leaked-password protection if the project plan supports it.
- [ ] Enforce a strong minimum password policy and verify existing-user behavior.
- [ ] Confirm service-role secrets exist only server-side and are not present in Vercel frontend variables, browser bundles, logs or GitHub content.
- [ ] Confirm RLS and direct execution denials for inventory tables and sensitive RPCs.
- [ ] Verify Owner, Manager with grant, Manager without grant, Employee with scan grant, Employee without scan grant and Kiosk permissions.
- [ ] Verify rate limiting or bounded abuse protection on login, kiosk pairing, QR scan and export endpoints.
- [ ] Confirm structured logs and alerts exist for auth anomalies, Edge Function 5xx, queue failures, inventory invariant failures and database errors.
- [ ] Confirm production monitoring is visible to at least two authorized company accounts rather than one developer account.

### F. Business approval

- [ ] Jonas or the formally authorized company representative signs the business Go/No-Go line.
- [ ] Technical release operator signs the technical Go/No-Go line.
- [ ] Pilot lead confirms the shadow period, pilot users, support contact and release window.
- [ ] Staff are told that the first 72 hours are a shadow/dual-run period and the existing source of truth remains available.

## 5. Safe merge plan for the stacked pull requests

Do not merge either PR until section 4A proves that a merge to `main` will not cause an uncontrolled production rollout.

1. Freeze changes and capture both head SHAs.
2. Merge PR #49 first.
3. Preserve ancestry with a merge commit, or if repository policy requires squash/rebase, explicitly rebase/cherry-pick only the PR #50 delta onto the new `main`.
4. Change PR #50 base to `main` and confirm its diff contains only the intended Autopilot delta.
5. Mark PR #50 ready for review only after the CI/staging-only migration decision is closed.
6. Run every gate in section 4C against the latest PR #50 head SHA. Checks attached only to an earlier SHA do not count.
7. Merge PR #50 only after technical and business Go are signed.
8. Create a release record that maps the final `main` commit to the database migration list, Edge Function versions, Vercel deployment ID and feature-flag state.

## 6. Production preflight evidence

Store output in a restricted release folder. Do not commit database credentials, access tokens, employee data or raw production dumps.

### Repository and CLI

```bash
git status --short
git rev-parse HEAD
git log -1 --oneline
supabase --version
vercel --version
```

The recorded commit must equal the approved final head. A dirty worktree is a No-Go.

### Supabase migration history and dry run

```bash
supabase link --project-ref "$AORA_PRODUCTION_PROJECT_REF"
supabase migration list
supabase db push --dry-run
```

Run the actual `supabase db push` only once, from the designated release operator or CI job, after its dry-run output is approved.

### Logical backup

```bash
supabase db dump --linked -f "release-evidence/pre-release-schema.sql"
supabase db dump --linked --data-only -f "release-evidence/pre-release-data.sql"
```

Keep these files encrypted and outside the public repository. Confirm whether managed Supabase schemas omitted by the CLI need separate recovery evidence for this release.

### Read-only database snapshot

```sql
select now() at time zone 'Europe/Berlin' as captured_at_berlin,
       current_database() as database_name,
       current_setting('server_version') as postgres_version;

select version
from supabase_migrations.schema_migrations
order by version desc
limit 50;

select schemaname, tablename
from pg_catalog.pg_tables
where schemaname = 'public'
  and tablename like 'inventory_%'
order by tablename;

select organization_id, location_id, flag_key, enabled, config
from public.feature_flags
where flag_key in (
  'inventory_v1', 'inventory_qr', 'inventory_printing',
  'inventory_employee_scan', 'replenishment_suggestions',
  'supplier_email', 'supplier_whatsapp', 'inventory_counting'
)
order by organization_id, location_id nulls first, flag_key;
```

Run protected-tenant fingerprints with the real organization ID only in the restricted operator session. Evidence should contain counts/hashes, not raw employee or payroll records.

## 7. Controlled deployment procedure

### Phase 0 - freeze

- Announce a release freeze.
- Reject unrelated merges until the pilot release is stable.
- Capture pre-release dashboards, production deployment ID, Edge Function versions, migration history and Tacheles fingerprints.

### Phase 1 - database, flags off

- Set a bounded `lock_timeout` and `statement_timeout` for the migration session based on the rehearsal result.
- Apply exactly the approved dry-run migration list in timestamp order.
- Verify all new inventory feature flags are false.
- Verify protected Tacheles row counts and hashes are unchanged except expected schema metadata.
- Verify sensitive functions are service-role only and client roles have no direct execute privilege.
- Stop immediately if migration history, row counts, RLS, grants or constraints differ from the rehearsal.

### Phase 2 - backend, flags off

Deploy only reviewed production functions. For this release that includes the canonical inventory endpoints required by PR #49/#50, but excludes DATEV and inventory load-test bootstrap functions.

After deployment:

- health endpoint returns success and the expected version;
- an unauthenticated inventory action is denied;
- Manager without grant is denied;
- Employee without scan permission is denied;
- no supplier Email or WhatsApp provider is falsely reported as configured;
- production logs show no new 5xx or authorization anomaly.

### Phase 3 - frontend, flags off

- Promote the immutable artifact built from the approved commit rather than rebuilding from an unrecorded state.
- Run Owner, Manager, Employee and Kiosk workforce smoke tests.
- Verify shift view, kiosk clock-in/pause/clock-out, time correction, mandatory task behavior, timesheet preview/export and logout.
- Confirm inventory is hidden/disabled for every non-pilot tenant and location.

### Phase 4 - one-location canary

Enable only `inventory_v1` for the chosen pilot organization/location. Then enable the minimum secondary flags one at a time:

1. read/view and base stock;
2. counting;
3. QR and printing;
4. employee scan for named test employees;
5. replenishment suggestions;
6. manual supplier Email/WhatsApp fallback.

Keep `supplier_email=false` until real provider credentials, sender domain authentication and delivery verification exist. Keep WhatsApp limited to the manual deep-link flow until Business Platform credentials and template approval exist.

Observe each stage before enabling the next. No organization-wide enablement during the first 72 hours.

## 8. Mandatory smoke tests

### Workforce regression

- [ ] Owner login and tenant/location selection
- [ ] Manager access limited to assigned locations
- [ ] Employee sees only personal data
- [ ] Kiosk bound to one location
- [ ] Clock-in, pause, resume and clock-out
- [ ] Duplicate/retry does not create a second clock event
- [ ] Time correction preserves original, reason, actor and approval
- [ ] Mandatory task gate and audited manager override
- [ ] Timesheet preview, one-time signature and PDF/XLSX output
- [ ] Tenant A cannot access tenant B by URL or API manipulation

### Inventory canary

- [ ] Inventory remains unavailable when `inventory_v1=false`
- [ ] Owner access works when enabled
- [ ] Manager with explicit location grant works
- [ ] Manager without grant is denied
- [ ] Employee scan is absent/denied without explicit permission
- [ ] Create item and receive stock using pilot-only fixtures
- [ ] Repeat identical receipt request and confirm no duplicate
- [ ] QR inspection and partial consume preserve the correct remainder
- [ ] Movement ledger delta equals balance delta
- [ ] Count adjustment preserves concurrent receipt/consumption
- [ ] Transfer cannot violate donor reorder floor
- [ ] Past MHD is rejected from good stock
- [ ] Expired write-off requires manager confirmation and is idempotent
- [ ] PO partial receipt adds only good quantity; damaged/missing remains evidence
- [ ] Manual Email and WhatsApp order messages contain correct cafe, supplier, SKU and quantity
- [ ] Clean up only pilot fixtures created for the smoke test; never delete existing business records

## 9. Rollback plan

### First response order

1. Disable the affected feature flags. For an inventory-only incident, disable all eight inventory flags for the pilot location first.
2. Stop further write actions and record incident time, affected tenant/location, deployment ID and request IDs.
3. Roll the frontend back to the recorded last known-good Vercel deployment.
4. Re-pin/redeploy the last known-good Edge Function versions if the incident is backend-related.
5. Verify core workforce service is restored.
6. Reconcile all writes that occurred after the incident start from immutable audit/ledger records.
7. Use database restore only for unrecoverable corruption or cross-tenant exposure, with explicit business approval and understood data-loss window.

Vercel rollback does not roll back Supabase schema/data or external services. Database migrations are therefore treated as forward-compatible and normally remain in place with features off. Do not execute improvised down migrations on a live database. A managed backup/PITR restore is the last-resort database rollback and can cause downtime and loss of writes after the restore point.

### Immediate rollback triggers

- any cross-tenant or cross-location data exposure;
- any unauthorized role gaining inventory, payroll or export access;
- any stock balance/ledger mismatch;
- any negative stock not explicitly supported by business rules;
- duplicate clock, receipt, consumption, transfer, waste or order movement after an idempotent replay;
- loss or mutation of existing Tacheles business data outside the approved pilot action;
- sustained production 5xx rate above 1% for 5 minutes on affected AORA endpoints;
- p95 latency greater than twice the recorded baseline for 15 minutes with user impact;
- kiosk, clock-out, timesheet approval or payroll export regression classified Critical or High;
- inability to observe logs or execute the proven rollback procedure.

## 10. 72-hour shadow rollout

### Day 1 - workforce only

- New release live, inventory flags off.
- Existing operational process remains available.
- Run four-role smoke tests and observe auth, kiosk, tasks and timesheets.

### Day 2 - manager inventory canary

- Enable inventory only for one Tacheles location and selected Owner/Manager accounts.
- Load a small real catalog only after permission and audit checks pass.
- Compare every AORA stock operation against the existing manual record.

### Day 3 - selected employee scan

- Grant scan permission only to named pilot employees.
- Compare QR consumption, balance and movement ledger at opening and close.
- Hold a Go/No-Go review for the 30-day pilot.

Shadow success requires zero Critical/High incidents, zero tenant/role violations, zero ledger mismatches and successful rollback evidence. Failure keeps AORA in shadow mode and resets the 72-hour stability clock after a fix.

## 11. Thirty-day pilot plan

- Week 1: dual-run, daily reconciliation and rapid support.
- Week 2: normal daily use; measure clock success, task completion, inventory accuracy and manager workload.
- Week 3: exception testing - offline retry, partial receipt, correction, count and permission changes.
- Week 4: payroll-period review/export, inventory close, accountant/manager feedback and final acceptance.

Pilot acceptance metrics:

- 0 Critical and 0 unresolved High incidents;
- 0 cross-tenant/location/role violations;
- 100% idempotent replay correctness for sampled sensitive actions;
- 0 unexplained stock ledger/balance differences;
- at least 99.5% successful clock operations excluding verified client connectivity outages;
- all payroll-period totals reconcile with the approved source records;
- documented support, backup, restore and rollback procedures are usable by a second authorized operator.

## 12. Sign-off

| Gate | Name | Decision | Timestamp | Evidence link |
|---|---|---|---|---|
| Technical release |  | GO / NO-GO |  |  |
| Database/recovery |  | GO / NO-GO |  |  |
| Security/privacy |  | GO / NO-GO |  |  |
| Pilot operations |  | GO / NO-GO |  |  |
| Dopamine authorized representative |  | GO / NO-GO |  |  |

No blank row may be interpreted as approval.

## 13. Authoritative references

- AORA Product & Technical Specification v1.1, 2026-08-16
- AORA Engineering, Research & Production Safety Rules
- Vercel - Rolling Releases: https://vercel.com/docs/rolling-releases
- Vercel - Instant Rollback: https://vercel.com/docs/instant-rollback
- Vercel - Rolling back a production deployment: https://vercel.com/docs/deployments/rollback-production-deployment
- Supabase - Database backups and PITR: https://supabase.com/docs/guides/platform/backups
- Supabase - Database migrations: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase CLI - `db push --dry-run`, migration history and dumps: https://supabase.com/docs/reference/cli/supabase-db-push
- Supabase - Managing environments: https://supabase.com/docs/guides/deployment/managing-environments
- Supabase - GitHub integration and required migration checks: https://supabase.com/docs/guides/deployment/branching/github-integration
- Supabase - Edge Function production deployment: https://supabase.com/docs/guides/functions/deploy
- Supabase - Password security and leaked-password protection: https://supabase.com/docs/guides/auth/password-security
- GitHub - Protected branches and required checks: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub - Latest-SHA requirement for status checks: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
- PostgreSQL - `lock_timeout` behavior: https://www.postgresql.org/docs/current/runtime-config-client.html
