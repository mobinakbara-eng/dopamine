# Release and Environment Gates

## Source-of-truth rule

A production deployment must identify:

- Git repository
- commit SHA
- branch or release tag
- build configuration
- environment
- database migration version
- Edge Function versions

A deployment with missing Git metadata may be retained temporarily for recovery, but it is not a valid future release process.

## Branch and environment model

- `main`: protected, production-releasable only
- `develop` or release branch: stable staging integration
- `agent/*`, `feature/*`, `fix/*`: pull-request work
- every non-production branch receives an isolated Vercel preview
- database work uses local Supabase or an approved preview branch/project

No preview deployment may use production service-role credentials or unrestricted production data.

## Pull-request gates

Required before merge:

1. scope and architecture review
2. formatting and lint
3. TypeScript strict type check
4. unit tests
5. API and schema contract tests
6. database migration and RLS tests when applicable
7. production build
8. preview deployment
9. Playwright critical-flow tests
10. accessibility automation
11. secret and dependency scanning
12. visual review for changed screens
13. migration/rollback note for stateful changes

## Critical end-to-end flows

At minimum:

- employee login and session expiry
- manager login with privileged control
- invitation and membership state
- schedule create, publish and employee confirmation
- clock in, pause, resume and clock out
- duplicate/replayed clock mutation rejection
- leave request and decision
- time correction preserving the original
- checklist assignment and completion
- payroll/timesheet period lock
- tenant and location isolation
- kiosk activation, revocation and locked-device behavior
- offline/reconnect behavior for kiosk clock intent

## Accessibility gates

- keyboard completion of primary flows
- automated axe checks on critical pages
- no serious/critical violations
- focus order and focus visibility review
- screen-reader verification of clock and form outcomes
- responsive tests at phone, tablet and desktop widths
- reduced-motion and zoom checks

## Performance budgets

Budgets are measured on representative devices and network conditions:

- critical employee and kiosk screens prioritize fast interaction over decorative payload
- JavaScript and image growth requires review
- long tasks and layout shifts are monitored
- manager tables and schedules use pagination/virtualization when data scale requires it
- backend latency is tracked by route and deployment

Exact numerical budgets are set after a measured baseline; they must then fail CI or alert on regression.

## Database release gates

- migration file committed and reviewed
- backward compatibility assessed
- destructive actions separated and explicitly approved
- seed/test data contains no real personal data
- RLS and grants verified
- Supabase security and performance advisors reviewed
- restore or forward-repair procedure documented
- application deploy order documented
- reconciliation query provided for data migrations

## Promotion model

Preferred production process:

1. build a deployment from the release commit
2. validate that exact preview deployment
3. run end-to-end and smoke tests
4. promote the validated deployment to production
5. monitor canary/internal tenants or a limited cohort
6. expand only while health indicators remain within thresholds

Do not rebuild different source at promotion time when the validated artifact can be promoted directly.

## Health indicators

- HTTP and client error rate
- authentication success/failure rate
- Edge Function error and latency
- clock-flow success and duplicate/conflict count
- schedule mutation conflict rate
- projection/reconciliation drift
- database connection and query health
- Web Vitals and interaction failures
- support-reported blocking issues

## Rollback gate

Before promotion, confirm:

- previous Vercel deployment ID is known and healthy
- feature flags can disable the new capability
- previous API/Edge Function version is available
- database change is backward compatible or has a tested forward repair
- responsible person and rollback trigger are named

## Release evidence

Store with each release:

- changelog
- commit and deployment IDs
- migration versions
- test summary
- screenshots or visual diff for UI changes
- accessibility result
- advisor/security result
- known limitations
- rollback target
- approval record