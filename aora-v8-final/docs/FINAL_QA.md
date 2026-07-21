# AoraAI Workforce V8 Final — QA Evidence

Date: 2026-07-22

## Isolation

- Canonical production frontend `aora/` was not modified.
- Original workspace `aora-demo` remained at revision 73 during final verification.
- The final copy uses workspace `aora-v8-final-demo` only.
- The final copy calls `aora-v8-final-access` and `aora-v8-final-workspace` only.
- Temporary Vercel root routing was removed after each preview build.
- The diagnostic Edge Function is inert, returns 404, and requires JWT.

## Build gates

- 8 overlay JavaScript modules passed `node --check`.
- Overlay markers for the isolated workspace and Edge Functions were verified.
- The original V8 frontend was copied at build time and was not edited.
- Vercel production build completed successfully on deployment `dpl_7x61pu4Xq2544U4nUnKPcbbancgZ`.

## Backend compilation

- `aora-v8-final-workspace` version 3 compiled and deployed from the modular source structure.
- The active workspace source is split into `index.ts`, `core.ts`, and `structural.ts` for reviewability.
- `aora-v8-final-access` remains isolated to `aora-v8-final-demo`.

## End-to-end authorization test

The final workspace version was tested with a temporary random session and automatic rollback.

| Test | Result |
|---|---|
| Owner loads complete organization | HTTP 200 |
| Owner creates a temporary store | HTTP 200; store present in returned state |
| Manager loads assigned scope | HTTP 200 |
| Manager can see only `loc_1` | Passed |
| Manager attempts to create a store | HTTP 403 |
| Manager attempts to create an employee in `loc_2` | HTTP 403 |
| Temporary store, account, and session cleanup | Passed |

## Final data verification

| Workspace | Revision | Locations | Employees | Admins | QA records |
|---|---:|---:|---:|---:|---:|
| `aora-demo` | 73 | 2 | 6 | 1 | 0 |
| `aora-v8-final-demo` | 10 before owner-email configuration | 2 | 6 | 1 | 0 |

## Email access

- Owner, manager, and employee pages support passwordless email links.
- The owner record in the isolated workspace is configured with the connected owner email.
- No test invitation was sent to a real person without permission.
- A real-mailbox delivery and redirect test must be performed from the final deployed domain before assigning the production alias.

## Production state

No production alias was changed. The original deployment remains separate from this copy.
