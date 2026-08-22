---
name: aora-incident-response
description: Triage and stabilize AORA production or staging incidents before broad refactoring. Use when the site is down, errors spike, deploys regress behavior, data workflows fail widely or a production issue needs root-cause analysis.
---

# AORA Incident Response

Priority order: protect data/security -> restore service -> diagnose root cause -> prevent recurrence.

## Steps
1. State affected environment, roles, routes/workflows and start time if known.
2. Check current deployment and last known-good release.
3. Check runtime/build errors and recent commits/migrations/config changes.
4. Determine blast radius and whether writes/data integrity are at risk.
5. Choose the lowest-risk mitigation: disable a feature flag if designed for it, roll back compatible frontend release, or patch the isolated cause.
6. Verify service recovery with real checks.
7. Perform root-cause analysis and add regression coverage.
8. Document timeline, cause, mitigation and follow-up.

Do not make speculative architecture changes during an active incident unless they are required to restore safe service.
