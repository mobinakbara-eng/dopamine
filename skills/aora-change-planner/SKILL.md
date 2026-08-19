---
name: aora-change-planner
description: Turn an approved AORA outcome into a minimal, reversible engineering plan with affected files, roles, data boundaries, tests, rollout and rollback. Use before R2 or higher implementation work.
---

# AORA Change Planner

Create a plan that can be reviewed before code grows.

Include:
1. user-visible outcome and acceptance criteria
2. current implementation path and root cause/gap
3. files/modules likely to change
4. affected Owner/Manager/Employee/Kiosk surfaces
5. workspace/location/identity/device/environment boundaries
6. schema/API changes and compatibility
7. loading/empty/error/retry behavior
8. security and privacy impact
9. tests to add/update
10. rollout and rollback
11. explicit non-goals

Prefer expand/migrate/contract for data changes. Avoid a second source of truth. If a plan requires deleting or bypassing a working subsystem merely to add a feature, re-evaluate the plan.
