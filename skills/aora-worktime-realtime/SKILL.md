---
name: aora-worktime-realtime
description: Design or debug AORA worktime transitions, pauses, corrections, approvals and realtime synchronization across Manager, Employee and Kiosk surfaces. Use for time tracking, clocking, stale state or cross-surface update issues.
---

# AORA Worktime and Realtime

Model worktime as authoritative transitions, not independent UI toggles.

Verify:
- legal/current transition from previous state
- server-side authority and conflict prevention
- idempotency/duplicate handling
- timestamps/timezone assumptions
- pause semantics
- correction request linkage and manager decision
- kiosk and employee view convergence
- realtime event authorization and payload validation
- fallback revalidation when realtime delivery is missed

A successful mutation should produce deterministic visible state without requiring manual reload when the product experience promises realtime behavior. Do not rely exclusively on realtime delivery for correctness; clients need a recovery/revalidation path.
