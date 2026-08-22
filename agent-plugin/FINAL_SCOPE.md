# Initial Scope Boundary

Version 0.1.0 delivers the AORA engineering guidance/control package only. It does not yet deploy a custom AORA MCP server or create new provider credentials.

Included now:
- portable plugin manifest
- Vercel MCP declaration
- repository guardrails
- 21 AORA skills
- evidence/risk/security/QA references
- validation/risk scripts
- routing/safety eval fixtures
- install/validation/review runbooks

Deferred intentionally:
- custom AORA control-plane MCP implementation
- new Supabase MCP credentials
- new GitHub App credentials
- automatic production writes
- automatic merge to main

Those deferred capabilities require separate permission and threat-model review rather than being bundled silently into the first plugin release.
