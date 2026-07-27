# Aora 8.1.0 Pilot — Tenant Isolation QA

Date: 2026-07-28
Environment: isolated staging only

## Implemented

- Added `manager_location_access` as the normalized manager-to-location authorization source.
- Backfilled the existing hardening Manager scope without deleting invitations, sessions or user-created data.
- Changed database authorization so `manager` is no longer treated as an organization-wide admin.
- Added location-aware RLS for locations, employees, time entries and leave requests.
- Added `aora-v8-pilot-workspace`, which resolves `organization_id` from the validated server session and ignores any tenant identifier supplied by the frontend.
- The existing hardening tenant is delegated to the established hardened workflow to preserve its behavior.

## Recorded attack test

A temporary Tenant B was created with:

- 2 locations
- 2 employees
- 1 Owner
- 1 Manager assigned only to Location A
- independent Owner and Manager sessions

Both requests deliberately supplied the production hardening organization ID in the request body.

Results:

- Owner response: HTTP 200, session organization remained Tenant B, both Tenant B locations visible, no Tenant A data returned.
- Manager response: HTTP 200, session organization remained Tenant B, only Location A, Employee A and Shift A visible.
- Location B, Employee B and Shift B were not returned to the Manager.
- The frontend-provided `organizationId` did not affect authorization.
- Temporary Tenant B and its sessions were deleted after the test; remaining QA organization rows: 0.

## Remaining scope before P0-1 can be called commercially complete

- Generic self-service company onboarding is not enabled in the production UI.
- The current access/login function still defaults to the isolated hardening workspace for the existing preview.
- Generic Kiosk mutations for newly provisioned tenants remain blocked until Punch Idempotency (P0-2).

Therefore this change closes the tenant/session isolation and manager-location database gap, but does not authorize public multi-tenant sale.