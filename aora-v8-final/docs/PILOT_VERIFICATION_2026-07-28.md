# Aora 8.1.0 Pilot Verification — 2026-07-28

Scope: `agent/aora-v8-hardening`, PR #6, Supabase Staging `xqgkawskftzurbujrpex` only.

Head verified before this document update: `be6c89d8c7fedbd3d523e56d4744a47edfff7ef5`.

## Final release-gate result

GitHub Actions run `30347238499` completed successfully:

- Source, crypto and immutable bundle build gate: passed.
- Owner login, dynamic workspace routing and Compliance Center: passed.
- Manager login, location scope and Compliance access: passed.
- Employee login and correction-request entry point: passed.
- Kiosk login, browser offline mode, encrypted AES-GCM queue and online resync: passed.
- Known breached password rejection through HIBP k-anonymity: passed.
- Invitation inspection, atomic activation with a safe password, session creation, password login, tenant scope and replay rejection: passed.
- GitHub OIDC ephemeral tenant bootstrap and cleanup: passed.
- Aggregate Aora Pilot Release Gate: passed.

The workflow does not require permanent staging passwords, PINs or onboarding secrets. Each run obtains a GitHub OIDC token, creates an isolated temporary tenant, masks all ephemeral values and removes the tenant after testing.

## Live staging verification

- Supabase project health was confirmed healthy in `eu-central-1`.
- Active pilot functions include Access v4, Workspace Rules v3, Monitoring v2, Onboarding v3, Compliance Proxy v1, Realtime Broadcast v1, Kiosk, Workspace, Compliance Core and CI Bootstrap.
- Dynamic workspace selection uses the validated `workspace` query parameter or session storage and defaults to `aora-demo`.
- Production database, production aliases, `main` and canonical `aora/` source were not changed.

## Passed database and backend tests

- Audit ledger: chain valid, mutation rejected and QA rows cleaned up.
- Punch idempotency: first request accepted, exact replay reused the receipt and payload mismatch was rejected.
- Rule engine: Pause, overlap, minimum rest, overnight and DST behavior verified.
- Backup snapshot checksum verified.
- Activation, password login, tenant scope and replay/expired/revoked invitation rejection verified.
- CSV, PDF, Audit and Steuerberater exports verified.
- Monitoring health and load fixtures verified.

## Root causes corrected

- Edge Functions used a variable named `URL` and later called `new URL(origin)`. The variable shadowed the global URL constructor and caused legitimate local/preview origins to be rejected with HTTP 403. Affected functions now use `SUPABASE_URL` and `new globalThis.URL(origin)`.
- Browser requests used JSON content types that created avoidable CORS preflights. Browser and Service Worker calls now use `text/plain;charset=UTF-8` while retaining JSON payload parsing server-side.
- The earlier database Realtime trigger depended on unavailable objects in the `realtime` schema. It was removed and replaced with authenticated REST Broadcast on a session-hash-derived topic plus a 60-second fallback.
- Compliance traffic now passes through an origin-safe server-side proxy that preserves JSON, PDF/CSV bodies, content disposition and checksums without exposing the service-role key.

## Security corrections applied

- Direct execution of sensitive `SECURITY DEFINER` RPCs was revoked from `PUBLIC`, `anon` and `authenticated`; execution remains limited to `service_role`.
- Raw activation/login session tokens were removed from `pilot_qa_runs` evidence.
- A before-write trigger redacts future token-shaped QA evidence.
- Invitation tokens are removed from the browser URL immediately after inspection.
- Browser monitoring redacts session-like values and query-string secrets before reporting.
- CI ledger cleanup is allowed only for verified `github-oidc-ci` tenants; real tenant ledgers remain append-only.
- Onboarding kiosk activation codes are generated with `crypto.getRandomValues`, not `Math.random`.
- Invitation activation checks passwords against Have I Been Pwned using the free Pwned Passwords range API. Only the first five characters of a SHA-1 hash are transmitted, response padding is enabled and the full password or full hash never leaves Aora.
- If the breached-password service is unavailable, activation fails closed with HTTP 503 instead of bypassing the security check.
- Browser QA verified that `Password123!` is rejected with HTTP 400 before the invitation can be activated.

The Supabase organization is on the Free plan, so the platform's separate Supabase Auth leaked-password toggle is unavailable. Aora Pilot does not use Supabase Auth for these credentials; its actual invitation/password path is now protected independently. If Supabase Auth is introduced later, the organization must move to Pro and enable the platform option.

## Repository source-of-truth

The repository now contains and gates the deployed sources for:

- Access
- Workspace and Workspace Rules
- Kiosk
- Monitoring
- Onboarding
- Realtime Broadcast
- Compliance Proxy
- CI OIDC Bootstrap
- Security and cleanup migrations

The Source Gate rejects fixed-workspace Access code, unsafe URL shadowing, missing HIBP k-anonymity markers, full-hash password range requests, `Math.random` onboarding codes, missing deployed-function sources and regressions to five-second polling.

## Vercel verification

A Branch Preview exists with state `READY`, and the Aora owner route returned HTTP 200 with the expected 8.1.0 shell. Newer Preview builds are currently blocked by Vercel Free-plan quota `api-deployments-free-per-day` after more than 100 deployments in one day. This is an external quota failure, not a source or build failure.

## Remaining external Stop-Ship item

- Build one fresh Vercel Preview from the final Head after the daily quota resets or the plan is upgraded, then record final visual/layout QA on that exact SHA.

PR #6 must remain Draft until that external release condition is satisfied. No merge or production promotion is authorized by this verification.