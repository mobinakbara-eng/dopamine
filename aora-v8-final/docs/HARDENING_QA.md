# AoraAI Workforce 8.0.9 Hardening — QA and Stop-Ship Reconciliation

Date: 2026-07-28

## Scope and verdict

The external audit described the canonical `aora/` 8.0.4 production source. The current isolated hardening branch is:

- Base: `agent/aora-v8-final`
- Head: `agent/aora-v8-hardening`
- Version: `8.0.9-hardening`
- Workspace: `aora-v8-hardening-demo`
- Preview only; `main`, production aliases and production Supabase are unchanged.
- Canonical `aora/` remains unchanged by the hardening branch.

The old 8.0.4 build is correctly considered Stop-Ship. Version 8.0.9 closes several cited P0 issues, but the product is still **not approved for general sale** because tenant provisioning, offline delivery, event idempotency, full legal rule coverage and browser E2E remain incomplete.

## P0 reconciliation

### Exact employee identity — fixed in 8.0.9

- Employee rendering requires an exact match to `session.subjectId`/`session.employeeId`.
- There is no fallback to `employees[0]`.
- A missing match clears local sessions and produces a controlled login error.
- Employee UI state is defensively reduced to the authenticated employee before rendering.
- Profile editing requires the exact authenticated employee and has no first-record fallback.

### Exact admin identity — fixed in 8.0.9

- Admin rendering requires an exact active, accepted admin matching `session.subjectId`/`session.adminId`.
- There is no fallback to `admins[0]`.
- Missing, pending or revoked admin identity forces reauthentication instead of impersonating another admin.

### Employee privacy and leave requests — fixed at API/RLS and reinforced in UI

- The deployed workspace function scopes employee `leaveRequests`, `timeEntries`, corrections, notifications, availability and other personal collections to `session.subject_id`.
- PostgreSQL RLS policies on `leave_requests` and `time_entries` permit authenticated users to read only records matching `private.current_employee_id(organization_id)`, unless the user is an organization admin.
- `workspace_snapshots` denies all direct anon/authenticated access.
- The 8.0.9 employee overlay independently filters leave and time data again before rendering.

### Public directory and Owner PIN — materially reduced

- Employees and Managers are not exposed in the public directory.
- Owner UI no longer loads the public directory or offers PIN login.
- Owner, Manager and Employee now use email/password only.
- The hardening Owner demo identity was disabled in the database.
- Verified result: Owner password login HTTP 200; Owner PIN attempt HTTP 401.
- The Kiosk device list is still public for activation-code selection. Replacing this with blind device enrollment/QR remains required before general sale.

### Kiosk punch authentication — fixed flow in 8.0.9

- Kiosk selection does not directly write a time entry.
- Kiosk creates a short-lived pending `REQUEST_CLOCK` request.
- The authenticated employee receives an approval panel in their personal account.
- Approval requires current geolocation and calls `APPROVE_CLOCK_REQUEST`.
- Employee can explicitly deny the request with `DENY_CLOCK_REQUEST`.
- Server-side flow records the transition only after approval.
- Pending, revoked, inactive and wrong-location accounts are rejected.

### Kiosk → Admin reauthentication — fixed in 8.0.9

- Entering Kiosk mode revokes the current admin session and removes Owner/Manager tokens from browser storage.
- Returning from Kiosk logs out the Kiosk session.
- Admin session is never restored from `sessionStorage`.
- Owner/Manager must enter email and password again.

### Tenant isolation — partially complete, still release-blocking

- Database rows include `organization_id` and sessions are validated against the hardening organization.
- Manager reads and mutations are location-scoped server-side.
- RLS policies exist for sensitive projected tables.
- However, this Preview still uses the fixed workspace slug `aora-v8-hardening-demo` and does not yet provide production-grade tenant provisioning, per-customer configuration, key rotation or automated cross-tenant E2E tests.

## Time integrity

### Active hours — fixed in 8.0.9

- Weekly worked time now includes a current `live` entry up to current Berlin time.
- A paused entry counts only until `pauseStartedAt` and excludes accumulated break time.
- Completed entries continue to use recorded start/end/break values.

### Multiple open entries — database invariant added

A partial unique index now enforces:

```text
one (organization_id, employee_id) where status is live or paused
```

A transactional QA test attempted to insert a second open entry and received `unique_violation`; the transaction was rolled back and left no QA records.

### Server time — present in the deployed backend

- Kiosk authorization derives date/time on the server in the Europe/Berlin timezone.
- Final approval uses server time again for the stored transition.
- Client geolocation timestamp is metadata, not the authoritative work timestamp.

## Existing protections retained

- PBKDF2-SHA256 password hashing with independent random salt and 210,000 iterations.
- Atomic database-backed login and invitation rate limiting.
- Atomic invitation acceptance with token lock, expiry/revocation/reuse check, revision check, credential write and token consumption.
- Strict CORS allowlist for approved Aora origins and the known team Preview suffix.
- Dedicated Kiosk Edge Function validates session, organization, location, device lock, employee status and allowed transition.
- Snapshot projection for the hardening workspace runs in the same database transaction.
- Manager state excludes non-assigned locations and payroll periods.
- Visual identity gates protect the current logo, typography, palette and canonical CSS order.

## Verified build

- Commit: `3303df29cac6cad65ed6b52318a9cc1948bfd099`
- Deployment: `dpl_FpYn287UNnnwszA24AfkHcfByjNy`
- State: `READY`
- Target: Preview only

```text
> aora-v8-final@8.0.9-hardening build
> node check.mjs && node build.mjs && node smoke.mjs
Aora hardening checks passed (15 overlay modules, version 8.0.9-hardening, cross-account, kiosk re-auth and open-entry invariants locked).
Aora V8 Final built without modifying ../aora
Aora post-build smoke checks passed (21 modules, 4 role routes, exact identities, personal punch approval, kiosk re-auth, active hours and visual markers).
Deployment completed
```

## Current staging state — preserved user data

The workspace is no longer an empty QA clone. Existing user-created records were preserved:

- revision: 5
- locations: 2
- employees: 6
- admins: 2
- invitations: 1 pending Manager invitation
- active sessions: 1 Kiosk session
- active credentials: 1 Owner credential
- temporary QA time entries: 0

No user-created Manager invitation or active Kiosk session was removed during this review.

## Remaining Stop-Ship items

1. **Generic multi-tenant onboarding and isolation test suite** — fixed workspace slug remains.
2. **Idempotency receipts for every punch** — no durable `event_id` receipt table and replay response yet.
3. **Encrypted offline punch queue and reconciliation** — not implemented.
4. **Full German rule engine** — overlap, daily maximum and break rules exist, but configurable Ruhezeit, DST, overnight, inactive-employee and tariff exceptions need complete test coverage.
5. **Polling architecture** — five-second full-state refresh remains; Realtime/delta updates are not implemented.
6. **Immutable correction/event ledger** — audit and original values exist, but a fully append-only regulatory ledger needs a dedicated design and retention policy.
7. **Production compliance package** — AV-Vertrag, TOMs, retention/deletion policy, data export/delete processes and regulatory exports remain.
8. **Automated tests** — cross-tenant, concurrent punch, offline, DST, RLS and Playwright role flows need CI enforcement.
9. **Manual protected-Preview QA** — Vercel SSO still blocks connected interactive browser automation.
10. **Real invitation activation/reuse test** — one full Owner-created Manager activation and replay-rejection test is still required.

## Release gate

Aora remains **Stop-Ship for public sale**. It can move toward a one-location controlled pilot only after items 1–4 and 8–10 above pass with recorded evidence. The PR must remain Draft and no production alias, `main` merge or production database migration may occur without explicit approval.
