# Target Architecture

## 1. Architectural goals

Aora must become a multi-tenant workforce platform that is safe to evolve, testable, internationally localizable, observable, and transferable to another engineering team or buyer.

The architecture optimizes for:

- independent change without breaking unrelated modules
- strict tenant and location isolation
- explicit human and kiosk trust boundaries
- auditable workforce and payroll-affecting actions
- reliable behavior during poor connectivity and concurrent edits
- gradual migration from the existing application
- reproducible infrastructure from Git

## 2. System boundaries

### Web application

One responsive Next.js application serves:

- employee workspace
- manager/employer workspace
- tenant administration
- support-safe impersonation only when explicitly designed and audited

The web application uses role-aware navigation, but authorization is enforced on the server and database, never only in the UI.

### Kiosk application

Kiosk is a separate PWA and Vercel project. It has:

- device activation and revocation
- location-scoped access
- short-lived, rotated device sessions
- minimal employee directory exposure
- offline-safe clock intent queue with idempotency keys
- no manager or tenant-admin code in its bundle

### Backend and data

Supabase provides Postgres, Auth, Storage and Edge Functions. The target data model is normalized and organization-scoped. Edge Functions are thin orchestration boundaries; core rules live in a framework-independent domain package and are covered by tests.

### Integration boundary

Payroll, accounting, POS, HR and messaging integrations use versioned adapters and an outbox pattern. External failures must not corrupt time, leave or schedule records.

## 3. Monorepo dependency rules

```text
apps/web ───────┐
apps/kiosk ─────┼──> packages/domain
                ├──> packages/ui
                ├──> packages/auth
                ├──> packages/data
                ├──> packages/i18n
                └──> packages/observability

packages/domain must not import Next.js, browser APIs, Supabase clients or UI code.
packages/ui must not contain business authorization logic.
packages/data implements interfaces defined by domain/application layers.
```

Circular dependencies are blocked in CI.

## 4. Domain modules

Each module owns its commands, validation, permissions, events and tests:

1. Identity and tenancy
2. People and contracts
3. Locations and teams
4. Scheduling and availability
5. Time and attendance
6. Leave and absences
7. Tasks, checklists and evidence
8. Timesheets, pay rules and export
9. Communication and notifications
10. Audit, compliance and retention
11. Reporting and analytics
12. AI assistance

AI is advisory by default. It must show rationale, respect permissions, avoid silent payroll-affecting writes, and require confirmation for high-impact actions.

## 5. Data architecture

### Tenant isolation

- Every tenant-owned row carries `organization_id`.
- Location-scoped entities also carry `location_id` where appropriate.
- RLS policies use membership and scope predicates, not merely `TO authenticated`.
- Service-role access exists only inside reviewed server-side functions.
- Cross-tenant queries have automated negative tests.

### Canonical model

The normalized tables become canonical in controlled phases. The existing `workspace_snapshots` JSON document is treated as a legacy compatibility read model until parity is proven.

Recommended transition:

1. Freeze and document the current snapshot schema.
2. Add typed adapters around the existing API.
3. Validate projection parity between snapshot and normalized tables.
4. Move one bounded context at a time to normalized canonical writes.
5. Keep reconciliation metrics and rollback capability.
6. Retire snapshot writes only after a full retention window passes without drift.

### Concurrency and idempotency

- Every mutation receives an idempotency key.
- Version columns or compare-and-swap protect concurrent edits.
- Time and payroll-affecting records are append/audit oriented.
- Corrections preserve original values and actor/reason metadata.
- Background delivery uses an outbox rather than direct best-effort calls.

## 6. Authentication model

### Human users

Use Supabase Auth for real users. Support:

- email or organization-approved SSO
- MFA for managers and privileged roles
- short session lifetime for sensitive actions
- invitation and membership lifecycle
- organization and location role assignments
- account recovery and session revocation

The existing selectable directory plus PIN remains demo-only and is not the production human authentication model.

### Kiosk devices

Kiosk uses a separate device credential model:

- one-time activation code
- hashed, rotatable device secret
- device and location binding
- revocation and last-seen monitoring
- short-lived access token
- rate limiting and replay protection

## 7. Internationalization and policy engine

Hard-coded `de-DE`, `Europe/Berlin`, German messages and German labor assumptions move behind configuration.

The platform must support:

- organization and user locale
- IANA timezone per organization/location
- locale-aware date, number and currency formatting
- translation keys instead of UI text embedded in business logic
- RTL layout readiness
- country-specific labor and break policies as versioned policy configuration
- legal-effective dates for contracts, pay rules and compliance rules

Initial locales: German and English. Persian and Turkish can follow without structural redesign.

## 8. Frontend architecture

- Server Components for secure initial data and low client payload
- Client Components only where interaction requires them
- schema-validated API inputs and outputs
- explicit loading, empty, error, offline and conflict states
- route-level error boundaries
- feature flags for controlled rollout
- accessible design tokens and reusable primitives
- no direct service-role or secret access from the browser

## 9. Observability

Every request and mutation should carry:

- request ID
- organization ID where safe
- actor ID and role
- route/function name
- action/event type
- result and duration
- deployment version

Operational requirements:

- error aggregation and alerting
- structured logs without sensitive payloads
- traces across Vercel and Supabase boundaries
- deployment health comparison
- audit log distinct from technical logs
- uptime and synthetic checks for login, schedule load and clock flow

## 10. Architecture decision records

Material decisions are recorded under `docs/architecture/adr/` before implementation. At minimum:

- strangler migration
- monorepo and application boundaries
- authentication and kiosk trust model
- canonical data transition
- tenancy/RLS model
- international policy engine
- observability and audit separation

## 11. Definition of architectural readiness

A module is ready for production only when:

- its code and infrastructure are reproducible from Git
- authorization is tested server-side and at RLS level
- migrations and rollback/recovery are documented
- unit, integration and end-to-end tests pass
- accessibility and responsive states pass
- telemetry and operational ownership exist
- no production-only manual dashboard change is required