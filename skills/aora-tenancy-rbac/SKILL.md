---
name: aora-tenancy-rbac
description: Protect AORA workspace, location, role, employee-identity and kiosk-device boundaries. Use for permissions, Manager access, Owner scope, employee data, invitations, admin actions, RLS or any query/mutation that crosses tenant boundaries.
---

# AORA Tenancy and RBAC

For every sensitive operation answer:
- which workspace?
- which location(s)?
- which authenticated identity?
- which role/assignment?
- which kiosk device/session if applicable?
- where is authorization enforced?

Manager UI filtering is not sufficient; enforce location scope at the backend/persistence boundary. Employee access must not become generic workspace access. Kiosk tokens must not become normal user sessions.

Test cross-tenant negatives deliberately: employee A -> B, manager A -> location B, wrong workspace, stale assignment, direct endpoint access and manipulated identifiers.

If simplifying code would broaden scope, do not take the simplification.
