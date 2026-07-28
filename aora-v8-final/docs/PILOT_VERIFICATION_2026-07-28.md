# Aora 8.1.0 Pilot Verification — 2026-07-28

Scope: `agent/aora-v8-hardening`, PR #6, Supabase Staging `xqgkawskftzurbujrpex` only.

## Live staging verification

- Supabase project health: `ACTIVE_HEALTHY`, region `eu-central-1`.
- Active pilot Edge Functions confirmed: access, workspace rules, kiosk, compliance, onboarding, monitoring and invitation QA claim.
- Tenant and manager-location RLS inventory reviewed against the live schema.
- Production database, production aliases, `main` and the canonical `aora/` source were not changed.

## Passed database and backend tests

- Audit ledger self-test: chain valid, two events verified, mutation rejected, QA rows cleaned up.
- Punch idempotency: first request new, exact replay reused the receipt, payload mismatch rejected, test row cleaned up.
- Rule engine: shift overlap, missing break, minimum rest and DST fallback violations detected; overnight shift accepted with an overnight hint.
- Backup snapshot: backup `483734cf-9e18-4a90-a734-dcdddc9ff51a`, source revision 6, checksum verified.
- Consolidated backend QA evidence already covers activation, password login, tenant scope, replay/expired/revoked rejection, CSV/PDF exports, monitor health and load fixtures.

## Security corrections applied

- Direct execution of eight sensitive `SECURITY DEFINER` RPCs was revoked from `PUBLIC`, `anon` and `authenticated`; execution remains limited to `service_role`.
- Raw activation/login session tokens were removed from `pilot_qa_runs` evidence.
- A before-write trigger now redacts future 64-character tokens at known QA evidence paths.
- Invitation tokens are removed from the browser URL immediately after server-side inspection.
- Browser monitoring redacts session-like values and query-string secrets before reporting.

## Bundle and release-gate work

- Workspace selection now comes from the validated `workspace` query parameter or session storage, defaulting to `aora-demo`.
- Access calls include `workspaceSlug`, fixing onboarding links that previously fell back to the hardening demo tenant.
- Five-second full-state polling was removed.
- Session-scoped Supabase Realtime broadcast subscription was added with a 60-second fallback refresh.
- Owner/Manager Compliance Center and Employee correction-request entry point were added to the bundle.
- Playwright coverage was added for Owner, Manager, Employee, Kiosk, invitation activation/login/replay and encrypted offline resync.
- GitHub Actions now contains source, browser and aggregate release gates. Required staging secrets are validated explicitly and tests are not silently skipped.

## Remaining Stop-Ship items

- GitHub Actions must complete successfully with the required staging secrets configured.
- Final Preview browser QA must confirm no console errors, unexpected failed requests or layout regressions on the deployed Vercel Preview.
- Deployed compliance, monitor and onboarding Edge Function sources must be reconciled into the repository or regenerated from migrations before the repository is treated as the complete deployment source of truth.
- Supabase Auth leaked-password protection remains disabled and should be enabled before a public production rollout.

PR #6 must remain Draft. No merge or production promotion is authorized by this verification.
