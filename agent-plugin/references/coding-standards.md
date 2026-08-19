# AORA Coding Standards

## Change discipline
- Prefer the smallest coherent change over speculative rewrites.
- Search for existing helpers, patterns and feature gates before introducing a parallel mechanism.
- Delete obsolete code only when all callers and tests are accounted for.
- Keep generated/build output separate from source unless the repository intentionally tracks it.

## Dependencies
Before adding a dependency, prove that existing platform/browser/project capabilities are insufficient. Record package purpose, maintenance signal, security surface and bundle/runtime cost. Pin versions according to repository convention.

## Frontend
- Preserve semantic HTML and keyboard access.
- Avoid duplicate state sources.
- Make loading/error/empty/success behavior explicit.
- Do not use client state as an authorization boundary.
- Keep role navigation and mobile behavior consistent with current AORA conventions.

## Backend/data
- Validate at the server/persistence boundary.
- Scope every sensitive operation to workspace/location/identity/device as applicable.
- Prefer idempotent transitions for retryable actions.
- Use database constraints where they encode durable invariants better than application checks.
- Make migrations backward-compatible when possible.

## Logging
Log enough to debug correlation and failure class without leaking credentials, secrets or unnecessary personal data. Avoid full payload logging for sensitive workflows.
