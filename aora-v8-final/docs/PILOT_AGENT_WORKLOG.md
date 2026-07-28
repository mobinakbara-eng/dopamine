2026-07-28 — P0-1 session-derived tenant isolation and manager location database scope implemented and tested against a temporary second tenant. Temporary QA data was removed after evidence capture.

2026-07-28 — Live staging verification completed for audit-chain immutability, punch idempotency, rule-engine pause/overlap/rest/overnight/DST behavior and verified backup snapshots.

2026-07-28 — Revoked direct anon/authenticated execution on sensitive security-definer RPCs. Redacted raw session tokens from QA evidence and installed a preventive before-write redaction trigger.

2026-07-28 — Fixed dynamic workspace routing for onboarding links, removed five-second polling, added session-scoped Realtime with a sixty-second fallback, browser diagnostic redaction and final Compliance/Correction UI.

2026-07-28 — Added mandatory GitHub Actions source/browser/release gates plus Playwright flows for Owner, Manager, Employee, Kiosk, invitation replay and encrypted offline resync. PR #6 remains Draft pending successful CI and Preview Console/Network QA.
