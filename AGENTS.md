# AORA Engineering Guardrails

These rules apply to all engineering work in this repository.

## Source of truth
- The active AORA application is `aora-v8-final/` unless repository evidence proves that this changed.
- Treat existing production-oriented behavior as intentional until code, tests, product requirements or runtime evidence prove otherwise.
- Extend the current system. Do not restart, replace or silently fork the application architecture for convenience.
- Historical source trees must not be reintroduced into the active build path unless an explicit migration plan requires it.

## Evidence before change
- Inspect the affected implementation and its tests before editing.
- For meaningful product, architecture, security, dependency or workflow changes, collect at least 7 relevant evidence items: at least 2 AORA code/test/doc items, 2 current primary technical sources, 2 competitor/product examples when product UX is involved, and 1 security/accessibility/standards source when applicable.
- Prefer primary documentation and source code. Record disagreement instead of cherry-picking.
- Never fabricate a test result, browser result, log result, deployment result or source.

## Change safety
- Work on a branch. Do not write directly to `main` for feature work.
- Use the smallest coherent diff that solves the root problem.
- Do not weaken authorization, RLS, tenant isolation, auditability, environment separation, CSP, rate limits, idempotency or offline protections merely to make a feature pass.
- Do not put secrets, service-role keys, private tokens, invitation secrets or user data into source control, fixtures, logs or plugin configuration.
- Production is not a test environment. Prefer local -> preview -> staging -> production.

## Required engineering checks
- Determine affected roles: Owner, Manager, Employee, Kiosk.
- Determine affected boundaries: workspace, location, employee identity, device, environment.
- Check loading, empty, success, error and retry states for user-facing changes.
- Check mobile and keyboard/accessibility behavior for interactive UI.
- For persistence changes, define backward compatibility, existing-data impact, rollback and verification.
- For realtime/offline workflows, test duplicate delivery, reconnect, stale state and idempotency.

## Existing AORA verification commands
Run the relevant subset, escalating with risk:
- `npm run check`
- `npm run build`
- `npm run smoke`
- `npm run test:e2e`
- `npm run test:load`

Run from `aora-v8-final/`. A passing narrow test is not sufficient evidence for a high-risk cross-role or database change.

## Release rule
A change is complete only when the requested scope is implemented and the evidence appropriate to its risk level exists. Production mutations, destructive database actions, auth/RLS changes and irreversible operations require an explicit release gate and rollback path.

Use the skills under `skills/` for detailed AORA workflows.
