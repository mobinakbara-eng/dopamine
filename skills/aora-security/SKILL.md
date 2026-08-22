---
name: aora-security
description: Perform AORA security review for auth, sessions, invitations, kiosk, RLS, uploads, realtime, monitoring, employee documents, admin functions and production configuration. Use automatically for security-sensitive or permission-sensitive changes.
---

# AORA Security

Use `agent-plugin/references/security-invariants.md` as mandatory review input.

## Threat-oriented review
Identify asset, actor, trust boundary, attacker-controlled input, authorization decision and persistence side effect. Test direct endpoint access, identifier tampering, replay, duplicate execution, stale sessions and oversized/malformed input where relevant.

Do not remove a security control to make tests or product flow simpler. Fix the incompatibility at the correct boundary.

For RLS/auth/session changes require `aora-tenancy-rbac`, backend tests and release gating. For secrets, use client/provider auth or scoped runtime credentials; do not commit tokens.
