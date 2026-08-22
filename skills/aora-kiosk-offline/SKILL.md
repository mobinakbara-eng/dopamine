---
name: aora-kiosk-offline
description: Protect and improve AORA kiosk activation, shared-device clocking, offline encrypted queue, reconnect reconciliation, geofence and idempotency. Use for kiosk, offline, service-worker or shared-device workforce flows.
---

# AORA Kiosk and Offline

Kiosk is a state machine across device, network and backend; do not treat it as a normal page.

For changes test:
- activation and expired/invalid device session
- correct workspace/location binding
- clock-in, pause and clock-out
- duplicate tap/event
- offline enqueue
- browser restart where supported
- reconnect/retry
- response lost after backend success
- dead-letter/failure handling
- geofence allow/deny
- employee sync/state refresh

Preserve encryption of offline-sensitive data and idempotent backend reconciliation. Never solve offline duplication by simply dropping retry; uncertain requests need deterministic reconciliation.
