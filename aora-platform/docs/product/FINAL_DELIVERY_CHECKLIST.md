# Aora Final Delivery Checklist

This checklist is the release contract for turning Aora into a production-grade international workforce SaaS. A checkbox is complete only when evidence exists in Git, CI, a preview deployment, test output, or an approved operational record.

## 1. Product ownership and scope

- [ ] Product owner is named and has release authority.
- [ ] Technical owner, data owner, security reviewer and rollback owner are named.
- [ ] Target customer profile is documented: cafés, restaurants, retail and hospitality teams.
- [ ] Initial market is Germany; expansion assumptions are isolated from core code.
- [ ] Primary roles are approved: organization owner, store manager, employee, kiosk device, platform operator.
- [ ] High-impact actions are listed: inviting users, changing roles, publishing schedules, correcting time, closing timesheets, deleting data.
- [ ] Success metrics are defined for onboarding, schedule publishing, clocking, invitation acceptance and support volume.

## 2. Repository and source of truth

- [ ] GitHub contains every deployable source file.
- [ ] Current Vercel production source/build is recovered and tagged.
- [ ] Every Supabase migration is committed in chronological order.
- [ ] Every active Edge Function is committed with its deployment settings.
- [ ] No production-only dashboard change remains undocumented.
- [ ] Lockfiles are committed and dependency versions are pinned.
- [ ] Branch protection requires review and passing checks.
- [ ] CODEOWNERS covers auth, RLS, payroll/time logic and infrastructure.
- [ ] Conventional commit and pull-request rules are documented.
- [ ] Architecture decision records exist for tenancy, auth, kiosk, invitations and migration.

## 3. Environment isolation

- [ ] Local environment runs with deterministic synthetic data.
- [ ] Pull requests receive isolated Vercel Preview deployments.
- [ ] Preview uses no production secret or unrestricted production data.
- [ ] Stable staging has its own Vercel environment and Supabase backend.
- [ ] Production has dedicated data, keys and domains.
- [ ] Environment variables are classified as public or server-only.
- [ ] Secret ownership and rotation procedure are recorded.
- [ ] Preview redirect URLs are allow-listed safely.
- [ ] Production domains cannot be assigned by an unreviewed feature branch.
- [ ] Spend limits and alerts are configured for Vercel and Supabase.

## 4. Tenant, store and role model

- [ ] An organization owner can create a store/location.
- [ ] Every store has a stable ID, unique slug, name, address, timezone, country and status.
- [ ] Owner can view all stores in the organization.
- [ ] Owner can invite a manager by email and assign one or more stores.
- [ ] Owner can suspend, reassign and remove manager access.
- [ ] Manager can see only assigned stores.
- [ ] Manager can invite employees only into assigned stores.
- [ ] Manager cannot create owners or managers unless explicitly granted.
- [ ] Employee is linked to one organization and a primary store, with future multi-store support documented.
- [ ] Employee can access only personal data and explicitly shared store/team data.
- [ ] Platform operator access is time-limited, reason-bound and audited.
- [ ] Role changes are audited with actor, target, old value, new value and timestamp.

## 5. Invitation and account lifecycle

- [ ] Owner invitation form validates email, role and store assignment.
- [ ] Manager employee form validates name, email, role/title and store.
- [ ] Invitation tokens are random, single-use, hashed at rest and expire.
- [ ] Invitation email is sent from a trusted server context.
- [ ] Existing-user and new-user invitation paths both work.
- [ ] Email links use approved redirect URLs and server-side confirmation.
- [ ] Invitation acceptance verifies authenticated email ownership.
- [ ] Acceptance creates or activates the correct organization membership atomically.
- [ ] Employee profile is linked to the accepted identity.
- [ ] Expired invitation can be resent without creating duplicate memberships.
- [ ] Invitation can be revoked.
- [ ] Duplicate pending invitations are prevented.
- [ ] User can belong to multiple organizations without cross-tenant leakage.
- [ ] Offboarding revokes memberships and active sessions as policy requires.
- [ ] Account recovery and email-change flows are tested.

## 6. Authentication and session security

- [ ] Production human login uses Supabase Auth, not the demo directory/PIN flow.
- [ ] SSR uses `@supabase/ssr` with request-scoped clients.
- [ ] Server authorization relies on verified claims or a fresh user lookup, never unverified session data.
- [ ] Auth session refresh uses Next.js Proxy and propagates cache headers.
- [ ] Authenticated routes are dynamic and never publicly cached.
- [ ] Managers and owners can enable MFA; privileged actions can require recent authentication.
- [ ] Sign-out and session revocation work across devices.
- [ ] Secret/legacy service-role key never appears in client bundles.
- [ ] Publishable key is the only browser-visible Supabase credential.
- [ ] Login, OTP and invitation endpoints are rate-limited.
- [ ] Leaked-password protection is enabled where password login exists.
- [ ] Security notification emails are enabled for sensitive account changes.

## 7. Authorization and RLS

- [ ] Every exposed tenant table has RLS enabled.
- [ ] Every tenant row includes `organization_id`.
- [ ] Store-scoped rows include `location_id` where applicable.
- [ ] Policies enforce membership and row scope, not merely `TO authenticated`.
- [ ] UPDATE policies contain correct `USING` and `WITH CHECK` clauses.
- [ ] Views exposed to clients use security-invoker behavior or are denied.
- [ ] Security-definer functions live outside exposed schemas where possible.
- [ ] Security-definer functions set a safe search path and perform explicit identity checks.
- [ ] Public execution privileges are revoked by default on privileged functions.
- [ ] Owner positive-access tests pass.
- [ ] Manager assigned-store positive-access tests pass.
- [ ] Manager other-store denial tests pass.
- [ ] Employee self-access tests pass.
- [ ] Employee other-user denial tests pass.
- [ ] Cross-organization denial tests pass for every core table.

## 8. Owner workspace

- [ ] Owner dashboard shows organization summary and all stores.
- [ ] Owner can create, edit, archive and restore stores.
- [ ] Owner sees manager assignment and invitation status.
- [ ] Owner can open a dedicated store page.
- [ ] Store page shows employees, manager coverage, operational health and configuration.
- [ ] Owner can invite managers from organization or store context.
- [ ] Owner can transfer a manager between stores safely.
- [ ] Owner can set organization locale, timezone defaults and country policy.
- [ ] Owner can configure billing contact and legal company data.
- [ ] Owner has audit-log access.
- [ ] Owner has privacy export, retention and offboarding controls.

## 9. Manager workspace

- [ ] Manager dashboard is scoped to the selected assigned store.
- [ ] Store switcher shows only assigned stores.
- [ ] Manager can invite and onboard employees.
- [ ] Manager can edit employee work profile without accessing unrelated private data.
- [ ] Manager can activate, suspend and offboard employees subject to policy.
- [ ] Manager can create and publish schedules.
- [ ] Manager can review live attendance and clock exceptions.
- [ ] Manager can decide leave and correction requests.
- [ ] Manager can assign checklists and review evidence.
- [ ] Manager can prepare and lock timesheets with required permissions.
- [ ] Manager actions are audited.

## 10. Employee workspace

- [ ] Employee sees today’s shift, clock state, tasks and important notices first.
- [ ] Employee can view schedule and confirmation state.
- [ ] Employee can submit availability and leave requests.
- [ ] Employee can review worked time and request corrections.
- [ ] Employee can complete assigned checklists and evidence.
- [ ] Employee can view personal contract/work settings allowed by policy.
- [ ] Employee cannot inspect another employee’s private time, leave, pay or contract data.
- [ ] Employee can change locale and accessibility preferences.
- [ ] Empty, loading, offline, conflict and expired-session states are designed.

## 11. Kiosk boundary

- [ ] Kiosk is a separate application and Vercel project.
- [ ] Kiosk uses one-time activation and rotatable device credentials.
- [ ] Device is bound to organization and store.
- [ ] Locked/revoked device cannot perform actions.
- [ ] Employee directory is minimized.
- [ ] Idle screen returns to privacy-safe state after each action.
- [ ] Clock actions use idempotency keys.
- [ ] Offline queue prevents duplicate clock events.
- [ ] Geofence policy is transparent and processes location only when required.
- [ ] Kiosk bundle contains no owner/manager capabilities.

## 12. Data integrity and workforce rules

- [ ] All time mutations preserve original values and correction reasons.
- [ ] Concurrent mutations use version checks or compare-and-swap.
- [ ] Idempotency is enforced for invitation, clock and integration mutations.
- [ ] Schedule overlap and break rules are tested.
- [ ] Country-specific labor rules are configuration, not hard-coded UI logic.
- [ ] Timesheet locking prevents silent historical edits.
- [ ] Post-lock adjustments use explicit adjustment records.
- [ ] Snapshot-to-normalized projection parity is measured during migration.
- [ ] Reconciliation reports detect drift.
- [ ] Backups and restore tests exist for critical data.

## 13. Internationalization

- [ ] German and English translations are complete for launch.
- [ ] Persian and Turkish architecture paths work without redesign.
- [ ] No user-facing string is embedded in domain logic.
- [ ] Dates, times, numbers and currencies use locale-aware formatting.
- [ ] IANA timezone is stored per organization/store.
- [ ] Daylight-saving transitions have automated tests.
- [ ] First day of week is configurable.
- [ ] RTL direction works for Persian.
- [ ] Email templates are localized.
- [ ] Legal and labor policies are versioned separately from language files.

## 14. Accessibility and UX

- [ ] WCAG 2.2 AA is the acceptance target.
- [ ] Primary flows work fully by keyboard.
- [ ] Focus is visible and never hidden behind sticky UI.
- [ ] Forms have labels, descriptions and associated validation errors.
- [ ] Clock, invite and mutation results are announced to assistive technology.
- [ ] Status is not communicated by color alone.
- [ ] Touch targets meet minimum size and spacing.
- [ ] Drag-and-drop has a keyboard alternative.
- [ ] 200% zoom and responsive layouts are verified.
- [ ] Reduced-motion preference is respected.
- [ ] German, English and RTL visual regression checks pass.

## 15. Code quality

- [ ] TypeScript strict mode is enabled.
- [ ] Domain rules do not import Next.js, Supabase or UI modules.
- [ ] Server and browser dependencies are separated.
- [ ] One component per file is the default.
- [ ] Components use semantic HTML before ARIA.
- [ ] Client components are kept at the smallest necessary boundary.
- [ ] Runtime input/output schemas use Zod.
- [ ] Database types are generated from Supabase.
- [ ] Circular dependencies fail CI.
- [ ] No `any` enters permission, payroll or time logic.
- [ ] Errors are typed, logged safely and shown as user-friendly messages.
- [ ] Sensitive data never appears in logs.

## 16. Testing

- [ ] Domain unit tests pass.
- [ ] Server action and repository integration tests pass.
- [ ] Migration tests pass from a clean database.
- [ ] RLS positive and negative tests pass.
- [ ] Invitation acceptance tests cover new, existing, expired, revoked and duplicate cases.
- [ ] Owner store-creation E2E test passes.
- [ ] Owner manager-invitation E2E test passes.
- [ ] Manager employee-invitation E2E test passes.
- [ ] Cross-store and cross-tenant attack tests pass.
- [ ] Kiosk replay/offline tests pass.
- [ ] Accessibility automation has no serious or critical violations.
- [ ] Visual regression is reviewed for changed screens.
- [ ] Load tests cover login, dashboard load and clock peaks.

## 17. Observability and audit

- [ ] Every request has a request ID.
- [ ] Technical logs contain deployment version and route/function name.
- [ ] Tenant and actor context are logged only where safe.
- [ ] Audit records are separate from technical logs.
- [ ] Invitation sent, accepted, resent and revoked events are audited.
- [ ] Store and role changes are audited.
- [ ] Authentication, RLS and Edge Function errors have alerts.
- [ ] Synthetic checks cover login, owner dashboard, manager dashboard and clock flow.
- [ ] Reconciliation drift has an alert threshold.
- [ ] Runbooks identify response owners.

## 18. Privacy and compliance

- [ ] Data inventory and classification are complete.
- [ ] Purpose, lawful basis, access and retention exist for each data class.
- [ ] Precise location is not continuously tracked.
- [ ] Retention jobs are automated and testable.
- [ ] Organization and user export are reproducible.
- [ ] Deletion/anonymization respects legal holds and payroll obligations.
- [ ] Data-processing agreement and subprocessors are documented.
- [ ] Support access is disclosed and audited.
- [ ] Incident notification process is documented.
- [ ] Privacy settings default to least exposure.

## 19. CI/CD and release

- [ ] Pull request runs format, lint, typecheck, unit, integration and build checks.
- [ ] Pull request creates a protected Preview deployment.
- [ ] Critical Playwright and accessibility tests run against Preview.
- [ ] Database changes require migration and RLS evidence.
- [ ] Release candidate identifies Git SHA, migration version and function versions.
- [ ] Validated candidate is promoted deliberately.
- [ ] Previous deployment is a known rollback target.
- [ ] Feature flags can disable new bounded contexts.
- [ ] Canary rollout starts with internal/demo tenants.
- [ ] Rollback trigger and responsible person are named before release.

## 20. Final launch evidence

- [ ] Final architecture review approved.
- [ ] Security review approved.
- [ ] Accessibility review approved.
- [ ] Data migration reconciliation approved.
- [ ] Owner → store → manager → employee flow demonstrated end to end.
- [ ] Invitation emails verified on major providers.
- [ ] Production configuration checklist signed.
- [ ] Incident and rollback drill completed.
- [ ] Customer onboarding documentation published.
- [ ] Support and escalation path published.
- [ ] Release notes and known limitations published.
- [ ] Production launch approval recorded.
