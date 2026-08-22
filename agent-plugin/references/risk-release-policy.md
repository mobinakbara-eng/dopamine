# Risk and Release Policy

## Risk classes

### R0 — read/research
No state change. Repository and public research are allowed.

### R1 — docs/tests/tooling/local-safe refactor
No runtime or persisted behavior change. Validate targeted files.

### R2 — application behavior
Frontend/module behavior, new feature logic, non-sensitive API use. Requires branch, targeted tests, `npm run check`/build as relevant and preview/browser validation for user-visible behavior.

### R3 — stateful/cross-client
Schema additions, realtime, offline queue, kiosk/worktime state transitions, significant data model changes. Requires R2 gates plus staging, rollback, existing-data analysis, duplicate/reconnect/idempotency checks and cross-role regression.

### R4 — security/production boundary
RLS, auth, sessions, permissions, sensitive Edge Functions, invitation security, production config/release. Requires security and tenancy review, explicit release gate and production verification plan.

### R5 — destructive/irreversible
Production deletes/truncates, destructive migrations, broad credential/permission changes. Requires explicit human approval, backup/recovery evidence and a demonstrated recovery path. Default is do not execute.

## Release sequence
Understand -> inspect -> research -> plan -> classify risk -> implement on branch -> static/targeted checks -> build -> browser/E2E -> preview -> staging where required -> regression -> release decision -> production -> post-release verification.

Do not represent a stage as passed unless it actually executed and produced evidence.

## Rollback-first rule
For R3+ define rollback before deployment. Prefer expand/migrate/contract database evolution and backward-compatible frontend/backend overlap. A rollback that destroys newly collected user data is not a valid rollback without an explicit data recovery strategy.
