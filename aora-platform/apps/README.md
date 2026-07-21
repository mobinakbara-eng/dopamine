# Application Boundaries

## `web`

Future Next.js App Router application for employee, manager and tenant-administration surfaces.

Rules:

- server-enforced authorization
- shared accessible UI package
- locale-aware routes and content
- typed domain/data adapters
- no direct service-role access
- legacy API access only through a named compatibility adapter

## `kiosk`

Future dedicated kiosk PWA.

Rules:

- separate deployment and release lifecycle
- device activation, rotation and revocation
- location-scoped data only
- privacy-safe idle state
- offline clock-intent queue with idempotency and reconciliation
- no manager/admin code or permissions in the kiosk bundle

## Why separate applications

The web and kiosk surfaces have different users, trust levels, device constraints, availability requirements and release risks. Sharing packages is useful; sharing the same application bundle and trust boundary is not.