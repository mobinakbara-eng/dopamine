---
name: aora-bug-hunter
description: Diagnose AORA defects using reproducible evidence, recent changes, logs, state transitions and focused tests before patching. Use for broken behavior, regressions, inconsistent UI/backend state, failed workflows or unclear error reports.
---

# AORA Bug Hunter

Do not patch the first suspicious line.

## Workflow
1. Define expected vs observed behavior and affected role/environment.
2. Reproduce when possible; capture deterministic steps.
3. Inspect current code path, tests and recent relevant commits.
4. Trace state across UI -> request/function -> database -> realtime/offline reconciliation.
5. Form ranked hypotheses and falsify them with evidence.
6. Identify root cause and blast radius.
7. Add a regression test that fails for the root cause when practical.
8. Apply the smallest fix preserving security and tenancy.
9. Run targeted and impacted-flow regression.

For production incidents, pair with `aora-incident-response`; restore safe service before broad refactors.
