# AoraAI Workforce 8.0.8 Hardening — QA Evidence

Date: 2026-07-27

## Safety and isolation

- Canonical production source `aora/` is unchanged compared with `agent/aora-v8-final`.
- Production branch `main` was not modified or merged.
- Existing final branch `agent/aora-v8-final` and its deployed functions were not replaced.
- Rollback branch: `backup/aora-v8-final-before-hardening-2026-07-27`.
- Working branch: `agent/aora-v8-hardening`.
- Backend work was performed only in Supabase staging project `xqgkawskftzurbujrpex`.
- Production Supabase was not modified.
- Hardening workspace: `aora-v8-hardening-demo`.
- Hardening Edge Functions:
  - `aora-v8-hardening-access`
  - `aora-v8-hardening-workspace`
  - `aora-v8-hardening-kiosk`

## Owner access

- The workspace owner record is `admin_1`.
- Owner email is `mobinakbara@gmail.com`.
- A PBKDF2-SHA256 credential with random salt and 210,000 iterations was created only for the hardening workspace.
- Owner password login returned HTTP 200 with `accessRole=owner`.
- Owner workspace load returned HTTP 200 with both assigned locations.
- Test sessions were revoked after verification.
- The plain-text password is not stored in this repository or this QA file.

## Visual identity and isolation gates

The build fails if the hardening layer attempts to replace the existing Aora identity:

- canonical `Manrope` and `Sora` font markers
- black, white and gray palette markers
- canonical 16px radius token
- canonical `.aora-logo`
- canonical CSS must load first; isolated extension CSS is appended
- overlay may not replace `:root`, `html`, `body`, global `*`, or `.aora-logo`
- canonical `aora/modules/kiosk-view.js` must remain free of hardening-specific code

No redesign or brand-system replacement was introduced.

## Review passes and fixes

### Authentication and request lifecycle

- Owner email/password authentication activated and verified.
- Session storage is namespaced by workspace slug and access role.
- Frontend network requests use a 15-second AbortController timeout.
- Network and timeout errors receive explicit user-facing messages.
- Concurrent mutations no longer fail silently; a busy mutation returns an explicit conflict.
- Public PIN directory is cleared and reloaded after logout or invalid session.
- CORS is restricted to approved Aora origins and the known Vercel team preview suffix.
- Arbitrary `*.vercel.app` origins are rejected.
- Database-backed rate limits protect directory, PIN login, password login and invitation actions.

### Owner → Manager / Employee invitation flow

- Duplicate global modal definitions were removed.
- Explicit invitation functions are now used:
  - `managerInvitationModal()`
  - `employeeInvitationModal()`
- Submit buttons are disabled while invitations are being processed.
- Invitation acceptance is atomic:
  - invitation row locked
  - expiry/revocation/reuse checked
  - workspace revision checked
  - credential written
  - token consumed
  - snapshot/revision updated
- Pending invitations remain visible in management screens but are excluded from active KPIs.
- Active Manager/Employee counts now exclude `pending` and `revoked` accounts.

### Snapshot and projection consistency

- A hardening-only database trigger projects snapshot changes inside the same transaction.
- Projection failure now rolls back the snapshot update instead of leaving a partial state.
- Transactional test confirmed snapshot and projection changed together.
- The test transaction was rolled back and left no QA marker.

### Manager scope

- Manager reads are limited to assigned locations.
- Manager does not receive payroll periods.
- Manager mutations use an explicit event allowlist.
- Every Manager mutation must resolve to an assigned location.
- Manager cannot create locations or change account scopes.
- Existing scope tests confirmed `loc_1` visibility and `loc_2` isolation.

### Kiosk hardening

- Kiosk traffic uses the dedicated `aora-v8-hardening-kiosk` guard.
- The guard validates the actual request body size, not only `Content-Length`.
- Kiosk transition requires a valid Kiosk session and location.
- Locked or inactive Kiosk devices are rejected.
- Pending, revoked, inactive or wrong-location employees are rejected.
- Allowed transitions are validated for `in`, `pause`, `resume` and `out`.
- Paused employees map `in` to `resume` instead of creating a second clock-in.
- Kiosk UI excludes `pending` and `revoked` accounts through an isolated overlay.
- Database `demo_login` now rejects locked/inactive Kiosk devices before creating a session.
- Transactional locked-device test returned the expected rejection and rolled back with zero sessions.

### Employee and date correctness

- Employee UI binds to `session.subjectId` instead of assuming `employees[0]`.
- Missing authenticated employee produces a controlled error state.
- Notification badges use the authenticated employee's real unread count instead of a fixed value.
- Date-only values use stable ISO/UTC arithmetic.
- Week start and date addition no longer depend on the device timezone.

## HTTP and authorization evidence

| Test | Result |
|---|---|
| Owner password login | Passed — HTTP 200, `accessRole=owner` |
| Owner full workspace load | Passed — HTTP 200, 2 locations |
| Public directory from approved origin | Passed — HTTP 200 |
| Directory exposes only minimal owner/kiosk fields | Passed |
| Unapproved Access origin | Passed — HTTP 403 |
| Missing workspace session | Passed — HTTP 401 |
| Oversized Access request with declared length | Passed — HTTP 413 |
| Manager loads assigned scope | Passed — HTTP 200 |
| Manager sees only `loc_1` | Passed |
| Manager does not see `loc_2` | Passed |
| Manager sees payroll periods | Passed — zero periods returned |
| Manager attempts to create location | Passed — HTTP 403 |
| Employee loads personal workspace | Passed — HTTP 200 |
| Employee sees only own record and location | Passed |
| Kiosk guard without session | Passed — HTTP 401 and guard header active |
| Kiosk guard from unapproved origin | Passed — HTTP 403 |
| Locked Kiosk database login | Passed — rejected, transaction rolled back |
| Atomic projection trigger | Passed — projection matched snapshot and rolled back |
| Hardening Edge Functions | Passed — all three ACTIVE |

## Vercel build verification

Latest ready branch alias:

- branch: `agent/aora-v8-hardening`
- alias: `dopamine-git-agent-aora-v8-hardening-mobins-projects-4f428afa.vercel.app`
- state: `READY`
- target: Preview only
- production alias: unchanged

Latest verified code-changing build:

- commit: `38bd9437608bba9a85ab6d279aaf1f74d1ace0ed`
- deployment: `dpl_9rrxnYd8LvfLJPo3Xoxb8BVizjQC`

```text
> aora-v8-final@8.0.8-hardening build
> node check.mjs && node build.mjs && node smoke.mjs
Aora hardening checks passed (13 overlay modules, version 8.0.8-hardening, identity, access and isolation locked).
Aora V8 Final built without modifying ../aora
Aora post-build smoke checks passed (19 modules, 4 role routes, authenticated employee, active metrics, stable dates, guarded kiosk, visual markers).
Deployment completed
```

## Final staging state

| Revision | Locations | Employees | Admins | Invitations | Active sessions | Active credentials | Live invitation tokens |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 6 | 1 | 0 | 0 | 1 | 0 |

The single active credential is the requested Owner email/password credential. No QA Manager, invitation, token or active test session remains.

## Security advisor note

- Supabase reports INFO notices for RLS-enabled tables with no direct policies. These tables intentionally have no anon/authenticated access and are used through service-role Edge Functions/RPCs.
- Sensitive `SECURITY DEFINER` functions were checked: anon/authenticated execute is denied and service-role execute is allowed.
- Supabase Auth leaked-password protection is reported as disabled, but Aora hardening credentials use the custom PBKDF2 credential table rather than Supabase Auth. A future production authentication migration should revisit this setting.

## Tests not claimed as complete

- A real mailbox delivery was not performed; the UI currently opens a prepared mail client and provides a one-time link for copying.
- Automated creation/acceptance/reuse of a real Manager invitation was blocked by the execution environment safety layer and was not bypassed.
- The invitation transaction and token protections are implemented, but the Owner must perform one real preview invitation activation before production release.
- Vercel Preview is protected by Vercel SSO. Build/output checks passed, but connected browser automation could not establish the interactive SSO cookie for full visual navigation.
- No production cutover, alias promotion or merge has been performed.

## Release gate

1. GitHub/Vercel build passes. — **Passed**
2. Route, asset, syntax, service, identity and isolation smoke suite passes. — **Passed**
3. Owner email/password login and workspace load pass. — **Passed**
4. Manager and Employee scope tests pass. — **Passed**
5. Kiosk session/device/account guards pass. — **Passed where execution was allowed**
6. Manual browser QA for Owner, Manager, Employee and Kiosk through the protected Preview. — **Pending**
7. One real Owner-created Manager invitation, activation and reuse-rejection test. — **Pending**
8. PR remains Draft and production remains unchanged until explicit approval. — **Enforced**
