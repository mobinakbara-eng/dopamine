# Shared Packages

Planned packages and ownership:

- `domain`: business entities, commands, policy interfaces and framework-independent validation
- `ui`: WCAG 2.2 AA primitives, design tokens and reusable product patterns
- `auth`: human and kiosk authentication interfaces and authorization helpers
- `data`: generated database types, repositories, API schemas and legacy adapters
- `i18n`: translation catalogs, locale formatting, timezone and RTL utilities
- `observability`: request context, structured logging, tracing and error-reporting adapters
- `config`: environment schemas and safe public/server configuration separation
- `testing`: factories, fixtures, accessibility helpers and contract-test utilities

Dependency direction is enforced: applications may import packages; packages must not import applications. `domain` stays independent of Next.js, Supabase, UI and browser APIs.