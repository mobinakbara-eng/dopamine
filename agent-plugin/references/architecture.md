# AORA Architecture Reference

This is a starting map, not a permanent truth. Re-verify against repository state before consequential work.

## Active application
- Canonical active tree at plugin creation: `aora-v8-final/`.
- Frontend source: `aora-v8-final/app/` using modular browser ES modules and role-specific UI.
- Build output: `dist/`.
- Backend: Supabase/Postgres plus Edge Functions for sensitive workflows.
- Hosting: Vercel.
- QA: source contracts plus Playwright E2E, smoke, environment/privacy and release hardening gates.

## Primary role surfaces
1. Owner / Inhaber: organization-wide operations.
2. Manager / Arbeitgeber: assigned-location operations.
3. Employee / Arbeitnehmer: identity-scoped personal workflows.
4. Kiosk: activated shared device scoped to location/workspace.

## Security boundaries
Always identify all applicable boundaries before code changes:
- organization/workspace
- location
- authenticated user/employee identity
- manager assignment
- kiosk device/session
- environment: development, preview/staging, production

UI hiding is not authorization. Sensitive actions require persistence/server enforcement.

## Stateful subsystems
Treat these as cross-surface systems rather than isolated screens:
- scheduling and publication
- worktime, pauses, correction requests and approvals
- kiosk online/offline clocking
- task lifecycle and clock-out gating
- leave
- invitations/onboarding
- team news
- employee documents/privacy
- compliance/export
- inventory and supplier ordering as it is introduced

## Architecture preservation test
Before proposing a new abstraction or dependency, answer:
1. Which current module owns the concern?
2. Can the change extend that module without parallel state?
3. Would a new abstraction reduce complexity after migration, or merely relocate it?
4. What old path becomes obsolete and how is it removed safely?
5. What tests prove old and new callers remain correct?
