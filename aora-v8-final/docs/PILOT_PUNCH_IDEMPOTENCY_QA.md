# Aora 8.1.0 Pilot — Punch Idempotency QA

Date: 2026-07-28
Environment: isolated staging only

## Implemented

- Added `punch_events` as a durable receipt table keyed by `(organization_id, event_id)`.
- Added atomic SQL functions to begin a punch, store the Kiosk result, claim Employee approval, store the final result, recover stale processing and release retryable failures.
- Added `aora-v8-pilot-kiosk` with deterministic `clock_<event_id>` requests.
- Added replay-safe approval and denial handling to `aora-v8-pilot-workspace`.
- Added browser-side event ID persistence for timeout and network retry.
- A repeated UUID with different employee, location, device or transition is rejected as a payload mismatch.

## Concurrent verification

A temporary QA tenant contained one location, one employee, one Kiosk and independent Kiosk/Employee sessions.

The same UUID was submitted ten times concurrently for clock-in and then the same clock-request approval was submitted ten times concurrently.

Observed database result after the first run:

- one `punch_events` receipt
- `attempts = 10`
- one clock request
- one time entry
- receipt status `approved`
- request HTTP status `200`
- approval HTTP status `200`
- stored clock-request ID matched the snapshot
- stored time-entry ID matched the snapshot

A second complete replay run returned:

- ten punch responses with HTTP 200
- ten approval responses with HTTP 200
- every response carried `x-aora-punch-replay: true`
- every punch response returned the same clock-request ID
- every approval response returned the same time-entry ID
- no errors
- no additional clock request or time entry

The temporary QA tenant, sessions and receipts were deleted after the test. The QA runner was replaced with a disabled HTTP 410 endpoint.

## Acceptance status

- Ten identical requests create one receipt: passed.
- Timeout/retry uses the same UUID: implemented and build-gated.
- Double click creates one clock request/time entry: passed concurrently.
- Replayed response returns the same result IDs: passed.
- Idempotency is enforced server-side: passed.

P0-2 is complete for the isolated pilot branch. Public production promotion remains blocked by the remaining P0 items.