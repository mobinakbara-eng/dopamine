---
name: aora-orchestrator
description: Route complex AORA engineering work through context, research, risk, implementation, QA and release gates. Use for multi-step AORA changes, broad requests, feature work, audits or when multiple AORA skills are likely needed.
---

# AORA Orchestrator

Act as the workflow router, not as a substitute for specialist analysis.

## Procedure
1. Re-read `AGENTS.md` and load `aora-project-context` for consequential work.
2. Restate the concrete outcome internally: user problem, actors, affected module, expected behavior and non-goals.
3. Inspect current source/tests before recommending architecture.
4. Load `aora-research-gate` when the change is meaningful or current facts/APIs matter.
5. Classify risk using `agent-plugin/references/risk-release-policy.md`.
6. Select specialists: product/UX, competitor, frontend, Supabase/backend, tenancy/RBAC, inventory, kiosk/offline, worktime/realtime, security, Vercel/incident, testing/release.
7. Create a change plan before R2+ writes. Identify affected roles and boundaries.
8. Implement the smallest coherent diff on a branch.
9. Run evidence-appropriate checks. Never claim unexecuted checks.
10. Stop before production/destructive actions when the release policy requires human approval.

## Routing examples
- Inventory redesign -> research + competitor + inventory + UX + backend/tenancy + testing.
- Clock-out bug -> bug hunter + worktime/realtime + backend + testing; add kiosk/offline if shared-device state is involved.
- RLS change -> Supabase/backend + tenancy/RBAC + security + testing/release.
- Production outage -> incident response first; optimize architecture only after service is stable.

## Completion
Return what changed, evidence used, checks actually run, unresolved risks and the exact next release gate. Do not hide partial completion.
