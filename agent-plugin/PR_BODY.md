# AORA Engineering Agent Plugin 0.1.0

## What changed

Adds a portable Agent Plugins 1.0.0 package for AORA engineering work without modifying the active AORA runtime.

- root `plugin.json`
- root `mcp.json` with official Vercel remote MCP endpoint
- root `AGENTS.md` persistent engineering guardrails
- 21 focused AORA engineering skills
- architecture, research, security, QA, release, connector and inventory references
- routing and negative/safety eval fixtures
- dependency-free manifest/skill validator and risk classifier
- install, validation and review runbooks

## Why

AORA needs repeatable engineering behavior that preserves the existing system instead of relying on one very large prompt. This package separates always-on invariants from on-demand skills and external tools.

## Runtime impact

None. This branch does not modify `aora-v8-final/app`, Supabase migrations/functions or Vercel production configuration.

## Safety model

- work on branches, not direct feature writes to `main`
- meaningful changes use repository + current external evidence
- R0-R5 risk classification
- explicit tenancy/security invariants
- staging/rollback gates for stateful changes
- human gate for production/destructive operations
- never fabricate unexecuted test/deploy evidence

## Validation

Schema shape of `plugin.json` and `mcp.json` was checked against the current canonical Agent Plugins 1.0.0 schemas. GitHub compare confirms plugin-only additive changes.

The included Node validator still needs to be run from a normal checkout. A clone attempt from the assistant execution environment failed because DNS for `github.com` was unavailable; no false pass is claimed.

Run:

```bash
cd agent-plugin
npm run validate
```

## Review focus

1. Review root `AGENTS.md` carefully because it becomes persistent coding-agent guidance after merge.
2. Confirm the evidence gate is strict for meaningful changes without burdening trivial fixes.
3. Confirm R3-R5 release gates match desired operational risk tolerance.
4. Test routing and negative/safety eval prompts in the intended ChatGPT/Codex client.
5. Authenticate Vercel MCP intentionally; do not grant broad production write access for initial testing.
