# AORA — DATEV Schnittstellen Partner Readiness

Stand: 2026-08-21

This document is an internal implementation/readiness record. It does **not** claim DATEV approval, technical release, partnership, certification or Marktplatz listing.

## Target

AORA's shortest credible payroll-partner route is:

1. DATEV Developer Portal / API onboarding.
2. `hr:exchange` sandbox integration.
3. Technical sandbox approval.
4. Production test system + sample-data approval.
5. Real customer use.
6. At least 25 customers using the implemented DATEV data service.
7. Three reference customers.
8. DATEV partner application, review, product presentation and partner decision.
9. Partner contract, technical/documentation review, marketing coordination and Marktplatz listing.

For a partnership connected to DATEV payroll software, the public DATEV requirement names the DATEV Lohnaustauschdatenservice (`hr:exchange`) for movement and/or personnel master data to **DATEV LODAS and DATEV Lohn und Gehalt**, used by at least 25 customers.

## Current AORA status

### Implemented in the DATEV feature branch / staging foundation

- Server-owned OAuth/OIDC Authorization Code Flow with PKCE.
- State, nonce and PKCE verifier handling.
- Encrypted refresh-token storage.
- No access token persisted in the database.
- Atomic refresh-token rotation to protect single-use refresh tokens.
- Explicit DATEV client/dataset access verification before showing a connection as connected.
- Disconnect flow with DATEV token revocation.
- Separate sandbox/production connection configuration.
- Exact payroll scopes for `hr:files` and `hr:exchange`.
- Technical HTTP log metadata without Authorization/token/payroll payload logging.
- `hr:exchange` polling guard: at most once per minute and finite polling window.
- Private DATEV export storage.
- LODAS movement ASCII generator from closed/locked payroll periods.
- Explicit Personalnummer and Lohnart mapping requirement; provider values are not guessed.
- DATEV owner-only sandbox setup UI prepared for staging.

### Deliberately not claimed as complete

- No DATEV Developer Portal client credentials are committed.
- No real DATEV sandbox login has been completed in this repository state.
- `hr:exchange` write transport is still feature-gated until the subscribed/current OpenAPI DTOs are pinned and contract-tested.
- Initial `hr:exchange` job creation/read-before-write reconciliation is not yet end-to-end complete.
- No production DATEV access or production technical approval.
- No DATEV test-system acceptance evidence.
- No 25-customer usage evidence.
- No three reference customers registered for DATEV partner review.
- No DATEV partner contract or Marktplatz status.

## External prerequisites to start the official process

The following must come from the DATEV-side setup and must never be pasted into source control:

- DATEV Developer Portal organization/app.
- `DATEV_CLIENT_ID`.
- `DATEV_CLIENT_SECRET`.
- Registered exact redirect URI.
- Subscription/onboarding for `hr:exchange` (and `hr:files` only if kept as a complementary route).
- Current subscribed OpenAPI contract.
- DATEV test dataset / test system and permissions.
- Beraternummer and Mandantennummer for the test dataset.
- Customer-specific Lohnart mappings.
- Current Lohn-und-Gehalt interface contract where applicable.

## AORA documents/evidence to maintain

### Company / product

- Legal entity that owns/offers AORA: **TBD before partner application**.
- Registered address, management and partner contact: **TBD**.
- Product one-pager and positioning.
- Customer/support model.
- Product presentation for DATEV.

### Privacy / security

- Data-flow and architecture diagram.
- TOMs / technical-organizational measures.
- DPA/AVV and subprocessor list.
- Retention/deletion policy.
- Incident-response process.
- Access-control and tenant-isolation evidence.
- Token/secret handling description.
- DATEV technical-log retention and support process.

### DATEV integration

- Supported use-case statement.
- AORA → DATEV field mapping.
- Lohnart mapping rules and ownership.
- Error-handling matrix.
- Customer onboarding/help documentation.
- Sandbox acceptance test plan/results.
- Production sample-data test plan/results.
- Release/version log for the DATEV connector.

### Partner evidence

For each qualifying customer, record internally:

- AORA organization ID.
- Customer/legal company name.
- DATEV service (`hr:exchange`).
- LODAS or Lohn und Gehalt.
- Connection activation date.
- First successful real transfer date.
- Most recent successful transfer date.
- Transfer/use-case type.
- Customer consent for possible reference contact (separate from normal service use).

For the three future reference customers additionally keep:

- Contact person and role.
- Tax-adviser/payroll context.
- Period of active use.
- Scope used.
- Measurable workflow benefit.
- Explicit permission to be named to DATEV.

## Technical acceptance gates

AORA should not book a DATEV sandbox approval meeting until all of these are green:

- Sandbox credentials configured server-side.
- Connection UI shows connected/disconnected state correctly.
- Dataset/client permission check executed before connected state.
- `hr:exchange` target use case works end-to-end.
- Read-before-write is implemented where DATEV requires it.
- Corrections do not silently overwrite movement records.
- Post-write verification is implemented for production flow.
- DATEV errors are translated into actionable AORA UI messages.
- Technical HTTP logs contain the required trace metadata and no sensitive tokens/payloads.
- Retry/polling behavior follows DATEV requirements.
- First-level support runbook exists.
- Test data contains no real production employee data for acceptance.

## Primary implementation scope

To reduce implementation risk, AORA should first target the monthly movement-data use case because it maps directly to payroll preparation/time data:

- regular hours,
- overtime,
- night/Sunday/holiday supplements where configured,
- customer-mapped one-time payroll values.

The implementation must remain provider-mapped and must never invent customer Lohnart numbers.

## Sources

Official sources used for this readiness record:

- DATEV — Die ersten Schritte zum Partnerstatus: https://www.datev.de/web/de/berufsgruppenuebergreifend/ueber-datev/portfolio/oekosystem/partnering/datev-marktplatz/erste-schritte-zum-partnerstatus
- DATEV — FAQ für Software-Hersteller: https://www.datev.de/web/de/berufsgruppenuebergreifend/ueber-datev/portfolio/oekosystem/partnering/datev-marktplatz/faq-fuer-softwarehersteller
- DATEV — DATEV Schnittstellen Anbieter: https://www.datev.de/web/de/marktplatz/datev-schnittstellen-anbieter/
- DATEV Developer Portal — Cloud Integration requirements: https://developer.datev.de/de/guides/interface-requirements
- DATEV Developer Portal — Cloud integration workflow: https://developer.datev.de/de/guides/cloud-integration-workflow
- DATEV Developer Portal — Authentication: https://developer.datev.de/de/guides/authentication
- DATEV Developer Portal — hr:exchange interface requirements: https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements
- DATEV Developer Portal — hr:exchange implementation information: https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/implementation-information
- DATEV Developer Portal — customer onboarding/help requirements: https://developer.datev.de/de/guides/requirements-customer-onboarding
