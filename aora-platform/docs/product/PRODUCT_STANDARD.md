# International Product Standard

## Product definition

Aora is a workforce operating system for cafés, restaurants, retail and hospitality teams. It combines scheduling, time and attendance, leave, operational checklists, communication, labor-cost visibility and guided AI assistance.

The initial commercial market is German small and medium-sized businesses. The product architecture must not prevent expansion to other countries, languages, labor policies or currencies.

## Primary roles and jobs

### Employee

Needs to understand today immediately, see and confirm shifts, clock safely, manage availability and leave, complete operational tasks, receive important communication, review worked time and request corrections.

### Manager / employer

Needs to build compliant schedules, control labor cost and coverage, approve exceptions, maintain people and locations, monitor live operations, close timesheets and export reliable data.

### Kiosk user

Needs a fast, low-error clock and task interaction on a shared device with clear privacy boundaries and recovery from weak connectivity.

### Tenant administrator

Needs organization settings, roles, locations, integrations, billing-related configuration, retention and security controls.

### Platform operator

Needs safe tenant provisioning, health monitoring and support tooling without unrestricted or invisible access to customer data.

## Information architecture

### Employee navigation

1. Today
2. Schedule
3. Time
4. Leave
5. Tasks
6. Team / News
7. Profile and settings

### Manager navigation

1. Overview
2. Schedule
3. Live attendance
4. People
5. Leave and requests
6. Operations / checklists
7. Timesheets and payroll export
8. Reports
9. Settings

### Kiosk

1. Select or identify employee with minimal exposed information
2. Choose valid next action
3. Verify location/device policy
4. Confirm result
5. Return automatically to privacy-safe idle state

Navigation is task-oriented, not database-table-oriented.

## Product design principles

### Today-first

The first screen answers: What must I do now? What changed? Is anything blocked?

### Progressive disclosure

Common actions stay simple. Compliance details, exceptions and advanced controls appear only when needed.

### Explicit state

Draft, published, confirmed, pending, approved, rejected, corrected, locked, offline and conflicted states are visually and semantically distinct.

### Safe high-impact actions

Publishing schedules, changing worked time, approving leave, closing payroll and AI-generated changes require clear summaries, confirmation and audit context.

### Designed failure states

Every critical flow defines loading, empty, offline, expired-session, permission-denied, conflict, partial-success and retry states.

### Mobile and shared-device ergonomics

Employee and kiosk primary actions use large touch targets, short paths, readable contrast and no hover dependency. Manager workflows remain usable on tablet and responsive on mobile, while dense planning can optimize for desktop.

## Accessibility baseline

Target WCAG 2.2 AA:

- complete keyboard navigation
- visible and consistent focus
- semantic landmarks and headings
- form labels, descriptions and error association
- screen-reader announcements for clock and mutation results
- no color-only meaning
- sufficient contrast and scalable text
- minimum target size and spacing
- reduced-motion support
- accessible drag-and-drop alternatives
- automated and manual accessibility tests

## Internationalization baseline

- no user-facing string in domain logic
- translation keys with pluralization and interpolation
- German and English complete before international launch
- IANA timezone handling and daylight-saving tests
- locale-aware dates, weeks, decimal separators and currency
- configurable first day of week
- RTL-safe layout primitives
- legal and labor rules separated from translations

## Core capability baseline

### Scheduling

- draft/publish lifecycle
- availability and leave awareness
- open shifts, swaps and confirmations
- skill and location constraints
- coverage requirements
- labor-cost forecast
- conflict and compliance warnings
- templates and copy-week controls

### Time and attendance

- clock in, pause, resume and clock out
- kiosk and mobile policies
- offline intent handling
- geofence policy with transparent failure and privacy rules
- corrections preserving originals
- locked periods and post-lock adjustments
- audit evidence

### Leave

- balances and policy-aware requests
- overlap validation
- manager decision flow
- calendar and scheduling impact
- configurable leave types and country rules

### Operations

- checklist templates
- conditional items
- evidence capture
- assignments and recurring tasks
- clock-out blocking policy with controlled exceptions
- daily logs and handover

### Reporting and export

- role-scoped dashboards
- time, absence, cost and compliance reports
- immutable export versions
- payroll adapter contracts
- traceable filters and timezones

### AI assistance

- scheduling suggestions with constraints and rationale
- anomaly and compliance explanation
- natural-language reporting
- no autonomous payroll-affecting commit by default
- human approval and audit of accepted suggestions
- evaluation dataset and quality monitoring

## Design system requirements

The shared UI package owns:

- typography, spacing, radius, elevation and color tokens
- light/dark/high-contrast behavior
- status semantics
- responsive layout primitives
- form, table, calendar and timeline patterns
- empty/loading/error/offline patterns
- accessible dialogs, sheets, menus and notifications
- data visualization guidelines

Product screens may compose these primitives but must not invent incompatible local patterns.

## Quality metrics

Track at minimum:

- login success rate
- schedule publish success and confirmation rate
- clock-flow success, rejection and duplicate rate
- data reconciliation drift
- correction and exception rate
- page and interaction performance
- crash-free sessions
- accessibility regressions
- support contacts per active organization
- onboarding completion and time to first published schedule

## Commercial readiness definition

Aora is sale-ready when a new customer can be provisioned, onboarded, operate multiple locations, invite real users, complete the primary workforce cycle, export required data, exercise privacy rights, receive support, and be migrated or offboarded without undocumented engineering intervention.