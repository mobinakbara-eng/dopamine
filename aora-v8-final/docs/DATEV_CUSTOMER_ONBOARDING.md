# AORA — DATEV customer onboarding draft

Status: internal draft for future DATEV review. This document must be revalidated after the subscribed `hr:exchange` OpenAPI contract and DATEV technical approval are available.

## What this integration is

AORA prepares payroll-relevant data and can connect it to DATEV payroll workflows. AORA is not a payroll calculation engine and does not replace DATEV LODAS or DATEV Lohn und Gehalt.

Until DATEV technical approval is completed, do not describe the connector as “von DATEV technisch geprüft”. Until a DATEV partner contract/listing exists, do not describe AORA as a DATEV Partner.

## Before connecting

The customer/authorized payroll or tax-adviser setup must provide:

- the DATEV authentication medium and permissions required for the subscribed data service,
- the correct Beraternummer,
- the correct Mandantennummer,
- the target payroll system: DATEV LODAS or DATEV Lohn und Gehalt,
- the customer-specific payroll/Lohnart mapping used for hours, supplements and other transmitted values.

AORA must not guess Lohnart numbers.

## Connect AORA to DATEV

Owner role only:

1. Open **Einstellungen** in the AORA owner area.
2. Open **DATEV-Anbindung**.
3. Enter Beraternummer and Mandantennummer.
4. Select DATEV LODAS or DATEV Lohn und Gehalt.
5. Save the dataset configuration.
6. Select **Mit DATEV verbinden**.
7. Complete authentication on the official DATEV login page.
8. Return to AORA.
9. AORA performs an explicit permission/client check for the configured DATEV dataset.
10. AORA shows **Verbunden** only after that check succeeds.

## What the owner must be able to see

The connection page should show, where available:

- connected/disconnected/error state,
- configured DATEV dataset,
- payroll system,
- person/account that issued the connection,
- connection/token validity information,
- date/time of the last permission check,
- disconnect control,
- link to DATEV “Verbundene Anwendungen”.

Secrets, access tokens and refresh tokens are never displayed.

## Disconnect

Selecting **Verbindung trennen** must:

1. revoke the current DATEV access/refresh authorization where technically available,
2. remove the locally stored encrypted refresh-token secret,
3. mark the AORA connection as disconnected,
4. leave an auditable business/technical trace without exposing token values.

The customer can also review connected applications in DATEV’s own “Verbundene Anwendungen” area.

## Payroll data preparation

Before any movement data can be transmitted:

- the AORA payroll period must be reviewed and closed/locked,
- blocking payroll exceptions must be resolved,
- each employee included in the transfer needs a valid DATEV Personalnummer mapping,
- each payroll line type needs an explicit customer/provider mapping,
- the mapping in effect for the payroll period must be versioned and traceable.

## Corrections

AORA must not silently overwrite already transmitted DATEV movement records. Corrections must follow the DATEV `hr:exchange` correction workflow applicable to monthly movements, including counter-booking/new transmission where required.

## Error handling

AORA is first-level support for the integration. The user should receive a readable AORA message rather than a raw API error.

Support must be able to trace a failed transfer using AORA correlation ID plus DATEV request/transaction identifiers from technical logs, without logging authorization secrets or raw payroll/person payloads unnecessarily.

## Acceptance disclaimer

Technical acceptance testing must use a DATEV test system and sample/test data only. Real production employee/payroll data must not be used during DATEV technical acceptance.

## Official references

- Cloud integration requirements: https://developer.datev.de/de/guides/interface-requirements
- Authentication: https://developer.datev.de/de/guides/authentication
- hr:exchange requirements: https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/documentation/interface-requirements
- Customer onboarding/help requirements: https://developer.datev.de/de/guides/requirements-customer-onboarding
