# Environment and Authentication Setup

## Safety prerequisite

Do not connect this branch to the current `aora-workforce-staging` Supabase project while that project serves the existing live application. Provision a dedicated non-production backend first.

A Supabase branch may have a cost. Create it only after cost approval. An alternative is a separate approved development project or local Supabase.

## Vercel projects

Create two independent Vercel projects from the monorepo:

### Aora Web

- Root directory: `aora-platform/apps/web`
- Framework preset: Next.js
- Node.js: 24
- Production branch: protected release/main branch only
- Preview deployments: enabled for pull requests

### Aora Kiosk

Create later from `aora-platform/apps/kiosk` with an independent domain, deployment lifecycle and secrets.

Do not reuse the legacy `aora-workforce` production project for the new application until cutover gates are approved.

## Required environment variables

### Browser-safe

```text
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_RELEASE_SHA
```

### Server-only

```text
SUPABASE_SECRET_KEY
```

Never prefix the secret key with `NEXT_PUBLIC_`. Restrict it to server runtimes and Vercel environments that need invitation administration.

Recommended URLs:

```text
Local:      http://localhost:3000
Preview:    unique Vercel preview URL
Staging:    https://staging.aora.example
Production: https://app.aora.example
```

## Supabase redirect allow-list

Add only approved origins and paths:

```text
http://localhost:3000/auth/confirm
https://<preview-pattern>/auth/confirm
https://staging.aora.example/auth/confirm
https://app.aora.example/auth/confirm
```

Avoid unrestricted wildcard redirects in production. Preview rules should be as narrow as Supabase and Vercel capabilities allow.

## Email templates

For SSR cookie-based authentication, configure invite and magic-link templates to send users through the application callback.

Recommended confirmation link shape:

```text
{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite
```

For magic links use the appropriate Supabase email type, for example:

```text
{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink
```

The exact query separator must be verified against the configured `RedirectTo`. The application callback supports both `token_hash` verification and PKCE `code` exchange.

Email content must be localized, identify the inviting organization/store, explain expiration and provide a support path. Never include the raw Aora membership token outside the controlled callback destination.

## Initial owner provisioning

The first organization owner is not created by the public login form.

Approved bootstrap process:

1. Create the Auth user through an audited admin operation.
2. Confirm the email.
3. Create/update `profiles`.
4. Insert an active `organization_memberships` row with role `owner`.
5. Record the actor and reason in the audit log.
6. Test owner access and cross-organization denial.
7. Disable or remove the bootstrap mechanism.

Do not create a permanent public owner-signup endpoint.

## Database activation sequence

1. Create isolated backend.
2. Pull the existing schema/migrations into Git.
3. Generate a migration using the Supabase CLI.
4. Review `supabase/proposals/owner_store_membership_foundation.sql`.
5. Move approved SQL into the generated migration.
6. Replace the proposal-only `rollback` with the migration’s normal execution behavior.
7. Apply to local/preview only.
8. Generate TypeScript database types.
9. Run RLS and invitation tests.
10. Run security and performance advisors.
11. Connect Vercel Preview environment variables.
12. Run owner → manager → employee E2E flow.

## Required email/invitation tests

- invited new user
- invited existing Auth user
- wrong email signs in
- expired invitation
- revoked invitation
- reused token
- duplicate pending invitation
- email provider failure
- callback missing token/code
- unsafe external `next` redirect attempt
- session revocation after role suspension

## Release readiness

Before production connection, record:

- Vercel project IDs and domains
- Supabase project reference
- environment owners
- secret rotation date
- migration versions
- Edge Function versions
- Auth template revision
- redirect allow-list
- tested rollback deployment
- incident owner
