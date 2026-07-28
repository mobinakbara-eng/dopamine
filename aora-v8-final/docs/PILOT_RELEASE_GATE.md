# Aora 8.1.0 Pilot Release Gate

The isolated preview remains Stop-Ship for public sale and PR #6 must remain Draft.

A one-location pilot requires all mandatory checks to pass with recorded, redacted evidence:

- session-derived tenant isolation and dynamic workspace routing
- manager location isolation
- durable punch idempotency and payload-mismatch rejection
- encrypted browser offline queue and online reconciliation
- German work-rule coverage for pause, overlap, minimum rest, overnight and DST
- invitation provisioning, activation, password login, tenant scope and replay rejection
- four-role Playwright flows for Owner, Manager, Employee and Kiosk
- Compliance Center, correction decision flow and export checks
- session-scoped Realtime with a long fallback refresh
- browser Console/Network QA on the deployed Preview
- mandatory GitHub Actions `Aora pilot release gate`
- no raw invitation, session, service-role or private tokens in repository, logs or QA evidence

Open Stop-Ship items are tracked in `PILOT_VERIFICATION_2026-07-28.md`.

No merge to `main`, production alias promotion, or production database migration is allowed without explicit approval.
