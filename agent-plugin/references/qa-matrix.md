# AORA QA Matrix

## User-facing state matrix
For every changed flow cover applicable states:
- initial/loading
- empty
- populated
- validation failure
- authorization failure
- network/backend failure
- success
- retry/recovery
- stale/realtime update
- mobile narrow viewport
- keyboard/focus behavior

## Role regression matrix
Ask whether each change affects:
- Owner
- Manager
- Employee
- Kiosk
- public invitation/onboarding
- compliance/export consumers

## Stateful behavior matrix
For worktime, kiosk, inventory and similar transitions test:
- happy path
- double-click/duplicate submission
- delayed response
- request succeeds but response is lost
- offline enqueue if supported
- reconnect/reconciliation
- stale client state
- concurrent actors
- timezone/date boundary when relevant
- permission change while session is active

## Test escalation
1. focused source/unit/contract check
2. `npm run check`
3. `npm run build`
4. targeted Playwright scenario
5. impacted-role E2E
6. broader E2E/regression for R3+
7. load test only when concurrency/performance risk warrants it

No screenshot or DOM existence check alone proves a stateful workflow is correct. Verify the persisted/backend state and the visible state when both matter.
