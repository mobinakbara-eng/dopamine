# Owner → Store → Manager → Employee Flow

## Product outcome

Aora is a multi-tenant workforce SaaS. One organization may operate many stores. The organization owner controls store creation and manager assignment. A store manager controls only the employees and operations of assigned stores. Employees receive personal accounts and can access only their own workforce data plus explicitly shared store content.

## Role hierarchy

| Capability | Owner / Admin | Store Manager | Employee |
|---|---:|---:|---:|
| View organization settings | Yes | No | No |
| Create/archive stores | Yes | No | No |
| Invite/revoke managers | Yes | No | No |
| Assign manager to store | Yes | No | No |
| View all organization stores | Yes | Assigned stores only | Primary/shared store only |
| Invite employees | Yes | Assigned stores only | No |
| Edit employee work profile | Yes | Assigned stores only | Own limited profile |
| Publish schedules | Yes | Assigned stores only | No |
| View private employee time/leave | Yes | Assigned stores only | Own records only |
| Approve leave/corrections | Yes | Assigned stores only | Submit own request |
| Close timesheets | Permission controlled | Permission controlled | No |
| Access platform support tools | No | No | No |

The browser interface never grants authority. Server actions and Postgres RLS enforce the same matrix independently.

## Owner journey

1. Owner signs in using the verified organization account.
2. Owner opens `/[locale]/owner`.
3. Owner creates a store with:
   - name
   - unique organization-scoped slug
   - address and postal code
   - country
   - IANA timezone
   - default locale
4. Server verifies active `owner` or `admin` membership.
5. RLS verifies that the location belongs to the owner’s organization.
6. Owner selects the store and invites a manager by email.
7. A pending invitation is created with:
   - random single-use token
   - SHA-256 token hash at rest
   - organization and store scope
   - requested role
   - inviter
   - seven-day expiration
8. Supabase sends a server-generated invitation email.
9. Owner sees pending, accepted, revoked or expired invitation status.
10. Owner can later suspend, transfer or revoke manager access through a separately audited action.

## Manager journey

1. Manager opens the invitation email.
2. Supabase verifies ownership of the invited email.
3. The app exchanges the email token on `/auth/confirm` and stores the session in secure cookies.
4. Manager accepts the Aora membership invitation.
5. The database function verifies:
   - authenticated user ID
   - authenticated email equals invited email
   - invitation is pending
   - token hash matches
   - token is not expired
   - organization and store exist
6. Membership becomes active with role `manager` and the selected `location_id`.
7. Manager opens `/[locale]/manager` and sees only assigned stores.
8. Manager creates an inactive employee work profile for the selected store.
9. Manager invites the employee by email.
10. If email delivery fails, the employee profile is removed or marked for reconciliation and the invitation is revoked.

## Employee journey

1. Employee verifies the invited email.
2. Employee accepts the membership invitation.
3. The acceptance transaction:
   - creates/updates the personal profile
   - creates/updates organization membership
   - links the membership to the employee work profile
   - activates the employee work profile
   - invalidates the invitation token
4. Employee opens `/[locale]/employee`.
5. Employee may access:
   - own shifts
   - own time entries
   - own leave and correction requests
   - assigned tasks/checklists
   - store announcements intended for their audience
6. Employee cannot access another employee’s private time, leave, contract or payroll data.

## Invitation state machine

```text
pending ──accept──> accepted
   │
   ├──revoke──────> revoked
   │
   └──expire──────> expired
```

Rules:

- A pending invitation is unique per organization, store, email and role.
- Tokens are single-use and stored only as hashes.
- A different authenticated email cannot accept the invitation.
- Existing Auth users receive a sign-in link; new users receive an invite.
- Resending creates a controlled replacement after the earlier invitation is revoked or expired.
- Acceptance is atomic: membership and employee activation succeed together or roll back together.

## Multi-store evolution

The current membership model supports one primary `location_id` per organization membership. International rollout should add a normalized `membership_locations` table before managers require many independently assigned stores.

Recommended future shape:

```text
organization_memberships
  id
  organization_id
  user_id
  role
  status

membership_locations
  membership_id
  location_id
  permission_profile
```

Do not encode multiple location IDs in JSON or comma-separated fields.

## Audit events

Record at minimum:

- organization.store_created
- organization.store_updated
- organization.store_archived
- membership.manager_invited
- membership.employee_invited
- membership.invitation_delivery_failed
- membership.invitation_accepted
- membership.invitation_revoked
- membership.role_changed
- membership.location_changed
- employee.profile_created
- employee.activated
- employee.suspended
- support.access_started / support.access_ended

Audit records contain actor, organization, target, store, request ID, deployment version and timestamp without storing raw invitation tokens.

## Error and recovery behavior

| Failure | User behavior | System behavior |
|---|---|---|
| Duplicate pending invitation | Explain existing invite | No duplicate membership/profile |
| Email provider failure | Show safe retry message | Revoke pending invite; reconcile employee stub |
| Expired token | Offer owner/manager resend path | No access granted |
| Wrong signed-in email | Ask user to switch account | No access granted |
| Concurrent acceptance | One succeeds | Later request sees token already used |
| Store archived before acceptance | Block acceptance | Owner must reassign or resend |
| Manager loses store scope | Stop future access immediately | Existing sessions re-evaluate RLS |
| Partial external outage | Preserve local transaction rules | Retry email/integration through controlled job |

## Definition of done for this flow

The flow is production-ready only when:

- a dedicated preview/staging Supabase environment exists
- the SQL proposal becomes a generated, reviewed and tested migration
- Supabase email templates and redirect allow-list are configured
- owner, manager and employee E2E tests pass
- cross-tenant and cross-store denial tests pass
- invitation resend/revoke UI is implemented
- audit events and alerts are visible
- final accessibility and security reviews pass
