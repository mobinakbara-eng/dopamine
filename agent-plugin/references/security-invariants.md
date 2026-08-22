# AORA Security Invariants

The following are invariants, not optional implementation details.

## Authorization
- Owner scope is organization/workspace controlled.
- Manager access remains limited to assigned locations and authorized workflows.
- Employee access remains identity/personal-data scoped.
- Kiosk access remains device/session/location scoped.
- Browser/UI checks never substitute for RLS, Edge Function or persistence-boundary authorization.

## Secrets and environments
- Never commit service-role keys, private sessions, invitation secrets or provider tokens.
- Production and staging backend configuration remain separate.
- Production builds must fail closed when required production configuration is missing or points at non-production resources.
- Do not place secrets in Agent Plugin `mcp.json` headers; Agent Plugins v1 treats header values as package-visible data.

## Workflow integrity
Preserve or improve:
- invitation replay/activation defenses
- rate limits on sensitive operations
- idempotency around worktime/kiosk transitions
- encrypted offline queue behavior
- device/session validation
- payload size/depth validation where monitoring/realtime accepts user-controlled input
- CSP and hardened response headers
- stored-content escaping

## Required abuse cases for sensitive changes
Test, as relevant:
- employee A requesting employee B data
- manager A requesting manager B/location B data
- stale/expired session
- wrong workspace identifier
- wrong kiosk/device/location
- duplicate request/event
- replayed invitation/action
- direct API call without UI path
- malformed and oversized input
- network retry/reconnect
