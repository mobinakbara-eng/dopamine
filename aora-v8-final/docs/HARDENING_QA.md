# AoraAI Workforce 8.0.7 Hardening — QA Evidence

Date: 2026-07-27

## Safety and isolation

- Canonical production source `aora/` was not modified.
- Production branch `main` was not modified or merged.
- Existing final branch `agent/aora-v8-final` and its deployed functions were not replaced.
- Rollback branch: `backup/aora-v8-final-before-hardening-2026-07-27`.
- Working branch: `agent/aora-v8-hardening`.
- All backend work was performed in Supabase staging project `xqgkawskftzurbujrpex`.
- Production Supabase project was not modified.
- Hardening workspace: `aora-v8-hardening-demo`.
- Hardening Edge Functions:
  - `aora-v8-hardening-access`
  - `aora-v8-hardening-workspace`

## Visual identity gate

The build check locks the existing Aora visual identity:

- canonical `Manrope` and `Sora` font markers
- black, white and gray palette markers
- canonical 16px radius token
- canonical `.aora-logo`
- canonical CSS is loaded first and the isolated overlay is appended
- overlay may not replace `:root`, `html`, `body`, global `*`, or `.aora-logo`

No redesign or brand-system replacement was introduced.

## Security changes

- Exact CORS allowlist for approved Aora domains and the known Vercel team preview suffix.
- Arbitrary `*.vercel.app` origins are no longer accepted.
- Public directory response is reduced to minimum PIN-login data:
  - owner id/name
  - kiosk id/name
- Public directory is loaded only for unauthenticated Owner and Kiosk pages.
- Request body limits:
  - Access: 32 KiB
  - Workspace: 2.5 MiB
- Atomic database-backed rate limiting for directory, PIN login, password login and invitation actions.
- Password hashing remains PBKDF2-SHA256 with random salt and 210,000 iterations.
- Invitation acceptance is implemented as one database transaction:
  - invitation row locked
  - expiry/revocation/reuse checked
  - workspace revision checked
  - credential written
  - token consumed
  - snapshot/revision updated
- Sessions are namespaced by workspace slug in browser storage.
- Manager read scope excludes all non-assigned locations and payroll periods.
- Manager mutations use an explicit allowlist and require a safely resolved permitted location.
- `KIOSK_TRANSITION` is mapped to the backend-supported `REQUEST_CLOCK` event.
- Resume from a paused state maps to `resume`, not a second clock-in.

## HTTP and authorization tests

| Test | Result |
|---|---|
| Public directory from approved origin | Passed — HTTP 200 |
| Directory exposes only minimal owner/kiosk fields | Passed |
| Unapproved origin | Passed — HTTP 403 |
| Missing workspace session | Passed — HTTP 401 |
| Oversized Access request | Passed — HTTP 413 |
| Owner loads complete hardening workspace | Passed — HTTP 200 |
| Owner creates temporary location | Passed — HTTP 200 and revision incremented |
| Manager loads assigned scope | Passed — HTTP 200 |
| Manager sees only `loc_1` | Passed |
| Manager does not see `loc_2` | Passed |
| Manager sees only employees in assigned location | Passed |
| Manager sees payroll periods | Passed — zero periods returned |
| Manager attempts to create location | Passed — rejected with HTTP 403 |
| Employee loads personal workspace | Passed — HTTP 200 |
| Employee sees only own employee record | Passed |
| Employee sees only own location | Passed |
| Kiosk transition event mapping | Passed — static/unit source verification |
| Paused employee maps `in` to `resume` | Passed — static/unit source verification |
| Atomic rate-limit function | Passed — allowed/attempt/retry values verified |
| Hardening Edge Functions deployed | Passed — both ACTIVE |
| Built route shells | Passed — Owner, Manager, Employee and Kiosk output exists |
| Built JavaScript syntax | Passed — 15 output modules |
| Built hardening endpoint markers | Passed |
| Built visual identity markers | Passed |

## Vercel build verification

The shared repository Vercel project initially reported a false-positive green deployment because it built the repository root without executing the Aora build. A branch-only root `vercel.json` was added so the preview explicitly runs the isolated app build.

Latest verified deployment:

- branch: `agent/aora-v8-hardening`
- commit: `17c4909201d44d1c6d7e8f4844cbff15470a4e95`
- deployment: `dpl_AoSc9XxmGB1uVTEE2zCZTFprmLaH`
- state: `READY`
- target: Preview only
- production alias: unchanged

Verified build log:

```text
> aora-v8-final@8.0.7-hardening build
> node check.mjs && node build.mjs && node smoke.mjs
Aora hardening checks passed (9 JavaScript modules, version 8.0.7-hardening, visual identity locked).
Aora V8 Final built without modifying ../aora
Aora post-build smoke checks passed (15 modules, 4 role routes, hardening services, visual markers).
Deployment completed
```

## Tests not claimed as complete

- A real mailbox invitation delivery and redirect was not performed.
- The direct end-to-end invitation acceptance/reuse test was blocked by the execution environment safety layer and was not bypassed. The migration, privileges, token checks and transactional implementation are present, but a real preview activation remains a release gate.
- The Vercel Preview is protected by Vercel SSO. The connected fetch/browser environment could verify deployment metadata and build logs but could not establish the interactive SSO cookie required for visual navigation.
- Full visual interaction testing of Owner, Manager, Employee and Kiosk routes therefore remains an explicit release gate.
- Kiosk HTTP end-to-end test session creation was blocked by the execution environment safety layer; the compatibility mapping was verified at source/unit level instead.
- No production cutover, alias promotion or merge has been performed.

## Cleanup verification

After QA, the hardening workspace was reset from the untouched final workspace and all temporary QA records were removed.

| Workspace | Revision | Locations | Employees | Admins | Invitations | Sessions | Credentials | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `aora-v8-hardening-demo` | 1 | 2 | 6 | 1 | 0 | 0 | 0 | 0 |
| `aora-v8-final-demo` | 22 | 2 | 6 | 1 | 0 | unchanged | unchanged | unchanged |

Temporary QA manager, temporary location and all hardening QA sessions were removed.

## Release gate

Do not merge or promote this version until all of the following are true:

1. GitHub/Vercel build passes from `agent/aora-v8-hardening`. — **Passed**
2. Post-build route, asset, syntax, endpoint and visual-marker smoke suite passes. — **Passed**
3. Preview browser checks pass for Owner, Manager, Employee and Kiosk routes. — **Pending because Preview SSO blocks connected browser automation**
4. Console and network requests are clean. — **Pending visual/browser run**
5. One real invitation delivery/activation/reuse-rejection test passes on the preview domain. — **Pending**
6. The PR remains reviewable and no production alias is changed before explicit approval. — **Enforced**
