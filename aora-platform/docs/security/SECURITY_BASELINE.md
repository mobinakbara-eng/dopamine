# Security and Privacy Baseline

## Standards

Aora uses the following engineering baselines:

- OWASP ASVS 5.0 as the application-security verification catalog
- OWASP Top 10 as an awareness and review baseline
- NIST Secure Software Development Framework for the development lifecycle
- GDPR privacy by design and by default
- WCAG 2.2 AA for accessible product delivery

This is an engineering baseline, not a claim of certification.

## Trust boundaries

1. Public browser
2. Authenticated employee browser
3. Privileged manager/admin browser
4. Shared kiosk device
5. Vercel server/runtime
6. Supabase Edge Functions
7. Postgres and Storage
8. External integrations
9. Platform support/operator access

Each boundary requires explicit authentication, authorization, input validation, logging and data minimization.

## Identity and authorization

- Human production access uses Supabase Auth or an approved identity provider.
- Privileged roles require MFA before sensitive operations.
- Authorization is enforced in server code and RLS.
- UI role checks are convenience only.
- Membership includes organization, role, status and optional employee/location scope.
- Cross-tenant and cross-location denial tests are mandatory.
- Support access is time-limited, reason-bound and audited.
- Sessions can be revoked; sensitive actions may require recent authentication.

## Kiosk security

- Kiosk is not treated as a normal human user.
- Activation codes are one-time and rate-limited.
- Long-lived raw secrets are never stored in the database.
- Device credentials are hashed, rotatable and revocable.
- Session tokens are short-lived and bound to device/location/version.
- The idle view exposes the least employee information necessary.
- The application resets to a privacy-safe state after each interaction.
- Offline actions carry idempotency keys and cannot be replayed silently.

## API and Edge Functions

- Public functions are minimized and documented.
- JWT verification is enabled unless the endpoint implements a reviewed custom trust model.
- CORS uses explicit production and preview-origin policy; broad wildcard CORS is not accepted for authenticated data APIs.
- Service-role keys exist only in server-side environments.
- Request and response schemas are validated.
- Rate limits consider actor, tenant, route and network signals.
- Error responses do not leak database or internal implementation details.
- Dependencies are pinned and regularly reviewed.
- Obsolete, bootstrap, smoke-test and artifact-transfer endpoints are removed from live environments after dependency verification.

## Database and RLS

- RLS is enabled on every exposed tenant table.
- Policies enforce membership plus row ownership/location scope.
- `TO authenticated` alone is not authorization.
- Update policies include both `USING` and `WITH CHECK` where appropriate.
- Security-definer functions are exceptional, reviewed, have a safe search path, and are not executable by public roles unless explicitly required.
- Service-only tables are documented and denied to browser roles.
- Every migration includes positive and negative authorization tests.
- Database advisors run after DDL changes.

## Sensitive workforce data

Classify at least:

- identity and contact data
- contracts, compensation and payroll-related data
- working time and attendance
- leave and health-related absence information
- precise location/geofence evidence
- photos, signatures and checklist evidence
- audit and support-access records

For each class define purpose, lawful basis, access roles, retention, export, deletion or legal-hold behavior.

## Privacy by design

- Collect only data needed for an explicit product purpose.
- Default visibility is the narrowest useful scope.
- Precise location is processed only during an explicit clock verification flow, not continuously.
- Retention jobs and deletion workflows are product features, not manual database tasks.
- User and tenant exports are documented and reproducible.
- Analytics avoid unnecessary personal identifiers.
- Logs redact tokens, PINs, secrets and sensitive payloads.

## Secure development controls

Every pull request must pass, as applicable:

- secret scanning
- dependency and license review
- lint and type checking
- unit and contract tests
- RLS and authorization tests
- static analysis
- migration validation
- end-to-end tests
- accessibility checks
- build and preview deployment

High-risk changes require a second reviewer:

- authentication and session code
- authorization/RLS
- time and payroll calculations
- data export/deletion
- kiosk activation
- service-role usage
- security-definer functions
- retention or destructive migration

## Incident readiness

Maintain runbooks for:

- compromised account or kiosk
- leaked secret
- cross-tenant data exposure
- incorrect time/payroll mutation
- failed migration
- Vercel outage or bad deployment
- Supabase service degradation
- lost or corrupted evidence

Runbooks must identify containment, notification, recovery, evidence preservation and post-incident review.

## Current remediation priorities

1. Recover all deployed source into Git.
2. Separate staging and production.
3. replace demo human PIN login with real identities.
4. Restrict wildcard CORS in the workspace function.
5. Inventory and retire obsolete public Edge Functions.
6. Document service-only tables that intentionally have no client policy.
7. Enable leaked-password protection for real human accounts.
8. Add automated RLS, tenant-isolation and session tests.
9. Move hard-coded labor and locale assumptions into versioned configuration.
10. Establish security review and dependency update ownership.