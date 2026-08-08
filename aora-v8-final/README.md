# Aora — Workforce Operations Platform

Aora is a multi-role workforce operations platform for teams that need scheduling, time tracking, employee workflows, task execution, leave management, workplace communication, kiosk clocking and compliance tooling in one system.

The current application is the **Aora 8.1.0 production-oriented build**. The active frontend is built directly from `aora-v8-final/app`; the historical `aora` and `overlay` source trees are no longer part of the build path.

> **Project status:** active development / controlled pilot. The repository contains production-oriented security, isolation, QA and deployment controls, but this README does not claim legal certification or general-sale compliance approval.

## Live demo

**Canonical deployment:** https://dopamine-blond.vercel.app/

Role entry points:

- **Inhaber / Owner:** https://dopamine-blond.vercel.app/inhaber/
- **Arbeitgeber / Manager:** https://dopamine-blond.vercel.app/arbeitgeber/
- **Arbeitnehmer / Employee:** https://dopamine-blond.vercel.app/arbeitnehmer/
- **Kiosk:** https://dopamine-blond.vercel.app/kiosk/dashboard/

The role applications require configured workspace credentials or an activated kiosk device.

## What Aora solves

Aora is designed to replace fragmented workforce workflows spread across spreadsheets, chat groups, paper timesheets, separate scheduling tools and manual approval processes.

The product connects four operational surfaces:

1. **Owner workspace** for organization-wide control.
2. **Manager workspace** for location-level workforce operations.
3. **Employee app** for personal schedules, worktime, leave and tasks.
4. **Kiosk mode** for shared-device clocking and location-based workflows.

All four surfaces operate against the same workspace data model while enforcing role and location boundaries.

## Core capabilities

### Organization and location management

- Multi-location organization structure.
- Owner-level organization overview.
- Location-scoped Manager access.
- Manager assignment and invitation flows.
- Employee account creation and onboarding.
- Kiosk device creation and activation.
- Workspace-aware invitation and kiosk links.

### Scheduling and calendar

- Employee schedule calendar.
- Manager weekly planning board.
- Shift creation and publication.
- Work-rule-aware shift creation.
- Shift preferences and availability support.
- Open-shift marketplace capability behind the unified feature system.
- Employee view combining schedule and operational tasks.

### Time tracking and worktime

- Employee worktime center.
- Kiosk clock-in / clock-out workflows.
- Server-authoritative worktime transitions.
- Geofence-aware kiosk flows.
- Pause and break handling.
- Prevention of conflicting open time entries.
- Employee time-correction requests.
- Manager approval / rejection workflow for corrections.
- Unified worktime views instead of separate legacy time-control screens.

### Offline kiosk operation

- Service-worker-enabled application shell.
- Encrypted browser offline punch queue.
- Workspace-bound offline kiosk sessions.
- Automatic reconciliation when connectivity returns.
- Retry and dead-letter handling for failed events.
- Durable event/idempotency controls designed to prevent duplicate punch processing.

### Task automation

- Reusable task templates.
- Manual task assignment.
- Location and employee targeting.
- Required checklist items.
- Task completion tracking.
- Manager visibility into task status.
- Clock-out gate that can block clock-out while required tasks remain incomplete.
- Feature-gated task automation for controlled rollout.

### Leave and absence workflows

- Employee leave requests.
- Start/end date and note capture.
- Manager review and approval.
- Role-scoped leave visibility.
- Integration with the broader employee and worktime experience.

### Timesheets and approvals

- Timesheet approval flows.
- Document-scoped timesheet handling.
- Timesheet document signing workflows.
- Controlled release/approval states.
- Worktime corrections connected back to recorded entries.
- Export and review tooling for administrative workflows.

### Team News and communication

- Manager/Owner Team News publishing.
- Location-aware announcement audiences.
- Audience permission enforcement at the persistence boundary.
- Employee-facing announcements.
- Atomic persistence paths for Team News updates.

### Employee documents and notifications

- Employee document notification UI.
- Personal document/workflow visibility.
- Privacy-oriented employee data presentation.
- Dedicated privacy-center experience and source-level privacy checks.

### Compliance, exports and backup

The administrative Compliance area consolidates operational review tooling rather than exposing separate legacy reporting pages.

Current capabilities include:

- Compliance / audit-oriented review screens.
- CSV export.
- Audit export.
- Steuerberater-oriented export.
- Verified backup flow.
- Worktime change review.
- Data escaping / stored-content safety checks.
- Privacy-oriented workflows and supporting QA coverage.

### Mobile and accessibility

- Responsive employee experience.
- Dedicated mobile-layout Playwright coverage.
- Accessibility hardening and automated accessibility checks.
- Horizontal-overflow checks across key role views.
- Production navigation QA for every rendered role section.

## Roles and permissions

| Role | Primary scope | Typical capabilities |
| --- | --- | --- |
| **Owner / Inhaber** | Entire organization | Locations, Managers, invitations, operations, worktime, compliance, settings |
| **Manager / Arbeitgeber** | Assigned locations | Schedule, worktime, leave, employees, Team News, kiosk, compliance, settings |
| **Employee / Arbeitnehmer** | Own account and personal data | Home, calendar, worktime, leave, tasks, personal workflows |
| **Kiosk** | Activated device + location | Shared-device workforce clocking and kiosk-specific transitions |

Aora intentionally keeps Manager access location-scoped and Employee access identity-scoped.

## Current navigation model

The current product uses unified operational sections. Several older standalone sections such as legacy `time`, `time-control`, `reports` and `approvals` navigation have been removed in favor of consolidated worktime and compliance workflows.

Owner navigation currently includes areas such as:

- Overview
- Locations
- Managers
- Invitations
- Operations
- Worktime
- Compliance
- Settings

Manager navigation includes areas such as:

- Overview
- Schedule
- Worktime
- Leave
- Employees
- Team News
- Kiosk
- Compliance
- Settings

The Employee mobile navigation currently centers on:

- Home
- Calendar
- Time
- Leave
- More

Tasks are integrated into the employee operational experience rather than depending on a separate legacy bottom-navigation tab.

## Architecture

### Frontend

- Modular browser application under `app/`.
- Build output generated into `dist/`.
- ES modules and feature-specific UI modules.
- Service worker for offline-capable workflows.
- Responsive role-specific interfaces.

### Backend

Aora uses Supabase/Postgres plus dedicated Edge Functions for security-sensitive and workflow-sensitive operations.

Environment-configured function responsibilities include:

- Access/authentication.
- Workspace and rule processing.
- Kiosk operations.
- Compliance operations.
- Monitoring.
- Onboarding.
- Realtime broadcast.

The application separates browser rendering from server-side authorization and persistence boundaries for sensitive actions.

### Data and tenancy

- Workspace/organization-aware data model.
- Role-scoped sessions.
- Manager location isolation.
- Employee identity scoping.
- Database policies and backend validation for sensitive data.
- Environment separation between development, preview/staging and production.
- Production builds are designed to fail closed when production database configuration is missing or points at the staging project.

### Deployment

- **Hosting:** Vercel.
- **Database/backend:** Supabase.
- **Canonical public demo:** `dopamine-blond.vercel.app`.
- Automatic Vercel aliases are redirected to the canonical demo origin.
- Public invitation and kiosk links are designed to use a stable canonical origin instead of immutable preview URLs.

## Security and hardening

The repository contains multiple layers of security and release hardening, including:

- Role and tenant/workspace authorization boundaries.
- Manager location restrictions.
- Employee identity scoping.
- Database-backed rate-limit controls for sensitive flows.
- Invitation activation/replay protections.
- Kiosk device/session restrictions.
- Event/idempotency protections around workforce transitions.
- Encrypted offline queue storage.
- Content Security Policy and hardened response headers.
- `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`.
- Restricted browser permissions policy.
- Realtime endpoint hardening and payload/rate validation.
- Monitoring payload size/depth limits.
- CI identity hardening through GitHub OIDC checks.
- Build-artifact hashing and source-SHA binding in release workflows.

Security controls are continuously tested and should not be interpreted as a substitute for an external security audit or legal/compliance certification.

## Quality assurance

The project uses both source-level contract tests and browser E2E tests.

Representative coverage includes:

- Four-role Owner / Manager / Employee / Kiosk flows.
- Unified navigation coverage.
- Calendar and Schedule Board.
- Task Automation and clock-out gating.
- Leave request and approval.
- Time corrections and Manager decisions.
- Timesheet approvals and document signing.
- Offline encrypted kiosk queue.
- Geofence enforcement.
- Tenant/backend scoping.
- Invitation onboarding.
- Team News authorization and persistence.
- Privacy Center.
- Accessibility.
- Mobile layout.
- Environment guards.
- Production hardening contracts.
- Realtime and monitoring hardening.

### Available commands

```bash
npm run check
npm run build
npm run smoke
npm run test:e2e
npm run test:load
```

`npm run build` runs the source checks, build pipeline, privacy/environment post-build gates and smoke tests before producing the final application.

## Local development

### Requirements

- Node.js **20 or newer**.
- npm.
- A configured Supabase environment for workflows that require backend access.

### Install

```bash
cd aora-v8-final
npm install
cp .env.example .env
```

Configure the environment values for the environment you are using. Do not place private service-role keys, private session tokens or invitation secrets in source control.

### Build

```bash
npm run build
```

The generated static application is written to `dist/` and can be served with a local static HTTP server.

## Environment configuration

Important environment variables include:

| Variable | Purpose |
| --- | --- |
| `AORA_DEPLOY_ENV` | Local environment selector when Vercel does not provide deployment context |
| `AORA_SUPABASE_URL` | Environment-specific Supabase project URL |
| `AORA_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase publishable key |
| `AORA_CANONICAL_ORIGIN` | Stable origin used to generate public links |
| `AORA_ACCESS_FUNCTION` | Authentication/access Edge Function |
| `AORA_WORKSPACE_FUNCTION` | Workspace/rules Edge Function |
| `AORA_KIOSK_FUNCTION` | Kiosk Edge Function |
| `AORA_COMPLIANCE_FUNCTION` | Compliance Edge Function |
| `AORA_MONITOR_FUNCTION` | Monitoring Edge Function |
| `AORA_ONBOARDING_FUNCTION` | Onboarding Edge Function |
| `AORA_REALTIME_BROADCAST_FUNCTION` | Realtime broadcast Edge Function |

Production and staging must use separate backend configuration.

## Repository structure

```text
aora-v8-final/
├── app/                     # Current frontend source
│   ├── index.html
│   ├── modules/             # Access, admin, calendar, compliance, privacy, worktime, etc.
│   └── *.css                # Feature and role-specific styling
├── docs/                    # QA, pilot verification and release evidence
├── supabase/
│   ├── functions/           # Edge Functions
│   └── migrations/          # Database and policy migrations
├── tests/                   # Source contracts, Playwright E2E and release tests
├── build.mjs                # Application build pipeline
├── check.mjs                # Source/build contract checks
├── smoke.mjs                # Post-build smoke validation
├── playwright.config.mjs    # Browser test configuration
├── vercel.json              # Hosting, redirects and security headers
├── .env.example             # Environment contract example
└── package.json             # Version, scripts and dependencies
```

## Release model

Aora uses an environment contract that separates development, preview/staging and production data.

- **Development:** local development and test workspaces.
- **Preview:** isolated Vercel previews backed by staging data.
- **Staging:** stable pilot/QA environment.
- **Production:** production Vercel target with production-only Supabase configuration.

Release workflows include source checks, build validation, browser/runtime coverage and hardened CI controls. Production-sensitive credentials are expected to stay in the deployment environment, not in the repository.

## Product principles

Aora is being built around a few core ideas:

- **One workforce system instead of disconnected tools.**
- **Role-specific interfaces on top of one shared operational model.**
- **Location isolation for Managers and personal-data isolation for Employees.**
- **Workflows that remain usable when connectivity is imperfect.**
- **Operational actions backed by explicit authorization and auditability.**
- **Mobile-first employee workflows with desktop-capable administration.**
- **Release gates and automated QA treated as product features, not afterthoughts.**

## Current version

`8.1.0-production`

The repository is under active development and the implementation may continue to evolve as pilot feedback, security reviews and operational testing progress.
