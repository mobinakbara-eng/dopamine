# AORA — DATEV technical acceptance test plan

Status: pre-acceptance plan. Execute only after the DATEV Developer Portal app, subscribed API product and test environment are available.

## Test-data rule

DATEV technical acceptance must use designated test systems / sample data. Do not use real production employee or payroll data during the acceptance process.

## Gate A — security and authorization

1. Start OAuth only from an authenticated AORA owner session.
2. Verify Authorization Code Flow + PKCE.
3. Verify state/nonce validation and one-time callback transaction handling.
4. Verify client secret and refresh tokens remain server-side.
5. Verify refresh token is encrypted at rest.
6. Verify access token is not persisted in AORA tables.
7. Verify connection is not shown as connected until the configured DATEV dataset/client access check succeeds.
8. Verify disconnect revokes the current authorization and removes the local refresh-token secret.
9. Verify cross-tenant access attempts are rejected.
10. Verify managers cannot change owner-only DATEV connection settings.

## Gate B — connection UI

1. Unconfigured state is clear and does not claim DATEV partnership/approval.
2. Missing server-side prerequisites are shown without revealing values.
3. Connected state displays configured dataset and connection metadata.
4. Last access check is visible.
5. Link to DATEV “Verbundene Anwendungen” is available.
6. Disconnect is explicit and requires user intent.
7. Raw OAuth/token values never appear in browser UI, browser storage or console logs.

## Gate C — monthly movement use case

Target initial partner-relevant scope: payroll monthly movements such as hours and configured supplements.

1. Create/read the initial DATEV job according to the subscribed `hr:exchange` contract.
2. Read current relevant DATEV state before sensitive writes where required.
3. Map AORA employee to DATEV Personalnummer.
4. Map AORA payroll line type to explicit customer Lohnart/provider mapping.
5. Submit a valid sample monthly movement.
6. Poll job no more frequently than DATEV permits.
7. Stop automated polling after the defined review window and surface manual reconciliation if needed.
8. In production-flow testing, verify persistence with the required post-write GET/job verification.
9. Store correlation metadata and remote job IDs for support/audit.

## Gate D — corrections

1. Transmit a sample movement.
2. Create a correction after initial transmission.
3. Verify correction uses the DATEV-prescribed movement correction model (counter-booking + new transmission where applicable).
4. Confirm no silent overwrite of already transmitted business history.
5. Verify both original and correction remain traceable in AORA audit history.

## Gate E — error handling

Exercise at least:

- unauthorized / expired authorization,
- missing dataset permission,
- invalid Berater/Mandant configuration,
- invalid employee Personalnummer mapping,
- missing Lohnart mapping,
- DATEV 4xx functional error,
- DATEV 429,
- DATEV 5xx,
- network timeout,
- duplicate/replayed local operation,
- polling-too-soon attempt,
- polling-window exceeded.

For each case verify:

- user receives an actionable German message,
- no secret/token is logged,
- technical correlation identifiers are available to first-level support,
- 4xx functional errors are not blindly retried,
- retry/backoff is controlled for retryable failures.

## Gate F — technical HTTP logging

Verify the log can support DATEV technical review with appropriate metadata such as:

- timestamp,
- HTTP method,
- DATEV host/path,
- response status,
- DATEV/global transaction/request identifiers where returned,
- AORA correlation ID,
- duration.

Verify the log does **not** contain:

- Authorization header,
- access token,
- refresh token,
- client secret,
- passwords,
- unnecessary raw payroll/person payloads.

Keep the documented DATEV technical-log retention policy active and verifiable.

## Gate G — LODAS and Lohn und Gehalt coverage

Because the public DATEV payroll partner condition names `hr:exchange` to DATEV LODAS and DATEV Lohn und Gehalt, prepare acceptance evidence for both target payroll products within the implemented scope.

Do not claim coverage for a payroll product until its actual contract, test setup and end-to-end results are verified.

## Evidence package per acceptance run

Archive internally:

- AORA build/commit SHA,
- DATEV API product/version,
- environment,
- test Berater/Mandant identifiers (non-secret),
- test scenario ID,
- timestamps,
- AORA correlation IDs,
- DATEV request/transaction IDs where available,
- expected result,
- actual result,
- screenshots where useful,
- remediation notes for any failure,
- final pass/fail sign-off.

## Official references

- https://developer.datev.de/de/guides/interface-requirements
- https://developer.datev.de/de/guides/cloud-integration-workflow
- https://developer.datev.de/de/guides/authentication
- https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements
- https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/implementation-information
