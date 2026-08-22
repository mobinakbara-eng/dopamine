---
name: aora-testing-release
description: Select and execute risk-appropriate AORA validation, Playwright/browser regression, preview/staging checks and release evidence. Use after implementation, before PR/release, or when deciding whether a change is safe to ship.
---

# AORA Testing and Release

Read `agent-plugin/references/qa-matrix.md` and `risk-release-policy.md`.

## Existing command ladder
From `aora-v8-final/` use the relevant subset:
- `npm run check`
- `npm run build`
- `npm run smoke`
- `npm run test:e2e`
- `npm run test:load`

Start focused, then expand with risk. A high-risk change is not validated by one narrow source test.

## Evidence
Record command/scenario, environment, result and failure details. Browser-visible success does not replace backend/persisted verification for stateful workflows.

## Release evidence for R3+
Include source SHA, PR/branch, migrations, affected roles, tests, preview/staging result, known limitations, rollback target and post-release verification plan.

Never mark production verified until production was actually deployed and checked.
