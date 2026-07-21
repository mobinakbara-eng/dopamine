# Aora Platform Foundation

This directory is the safe modernization track for Aora.

## Non-negotiable safety rules

1. `../aora/` remains the legacy production baseline until replacement gates pass.
2. No production deployment may originate from an uncommitted bundle or a Vercel upload without Git metadata.
3. GitHub is the source of truth for application code, Supabase migrations, Edge Functions, tests, and release notes.
4. Every change enters through a pull request and an isolated preview environment.
5. Database changes are forward-compatible, reversible where practical, and tested against a non-production Supabase environment before production.
6. Migration uses a strangler pattern: replace one capability or route at a time, preserve rollback, and avoid a big-bang rewrite.

## Target repository layout

```text
aora-platform/
  apps/
    web/                 # Employee, manager and tenant-admin web/PWA
    kiosk/               # Dedicated kiosk PWA and device trust boundary
  packages/
    domain/              # Framework-independent business rules and types
    ui/                  # Accessible design system and tokens
    auth/                # Human and device authentication adapters
    data/                # Typed repositories and API contracts
    i18n/                # Locales, timezone, currency and RTL support
    observability/       # Logs, traces, metrics and error reporting
    config/              # Validated environment and shared configuration
    testing/             # Fixtures, factories and test helpers
  supabase/
    migrations/          # Versioned schema and RLS changes
    functions/           # Versioned Edge Function source
    seed/                # Non-sensitive deterministic test/demo data
    tests/               # RLS, migration and database contract tests
  docs/
    architecture/
    product/
    security/
    operations/
```

## Migration principle

The current application continues serving users. New code is introduced behind separate preview/staging URLs and, later, route-level feature flags. Production traffic moves only after parity, security, accessibility, data-integrity and rollback checks pass.

## Proposed stack

- Next.js App Router with TypeScript for the web surfaces
- Separate kiosk application for stronger release and security isolation
- pnpm workspaces and Turborepo for a controlled monorepo
- Supabase Auth, Postgres, Storage and Edge Functions with committed migrations
- Zod-based runtime validation and generated database types
- Playwright for end-to-end and visual regression tests
- Vitest for domain and integration tests
- WCAG 2.2 AA design system with keyboard, screen-reader, responsive and RTL support
- OpenTelemetry-compatible observability plus Vercel and Supabase operational telemetry

## Current-system compatibility

The first adapter may continue calling the existing `aora-access-pages` and `workspace` functions. The current workspace snapshot remains a compatibility layer while normalized tables are verified and promoted to the canonical write model. Dual writes are not introduced without idempotency, reconciliation and rollback controls.

See the documents in `docs/` before implementing product code.