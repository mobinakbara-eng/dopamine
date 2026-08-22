# AORA Engineering Agent Plugin

This repository is an Agent Plugins 1.0.0 package for AORA engineering workflows. The portable plugin manifest lives at repository root (`plugin.json`), skills are discovered from `skills/`, and the remote Vercel MCP connection is declared in `mcp.json`.

## What it does

The plugin routes AORA work through explicit context, research, risk, implementation, QA and release gates. It is designed to prevent common agent-development failures: rebuilding the product from scratch, editing the wrong source tree, weakening security to unblock a feature, skipping cross-role regression, treating production as staging, or claiming checks that did not run.

## Current AORA assumptions

The initial reference set is based on the current repository state at plugin creation: `aora-v8-final` is the active production-oriented build, with Owner, Manager, Employee and Kiosk surfaces, Supabase/Postgres and Edge Functions, Vercel hosting, environment separation and Playwright/source-level QA. The `aora-project-context` skill must re-verify these facts at the start of consequential work so the plugin does not become stale.

## Portable components

- `plugin.json`: Agent Plugins 1.0.0 manifest.
- `mcp.json`: Vercel MCP using Streamable HTTP. Authentication is client-managed; no secrets are stored here.
- `skills/*/SKILL.md`: focused Agent Skills.
- `AGENTS.md`: always-on repository guardrails for coding agents that support it.

## Local validation

From `agent-plugin/` run:

```bash
npm run validate
npm run risk -- aora-v8-final/supabase/migrations/example.sql
```

The validation script is dependency-free and checks the manifest, MCP shape, skill frontmatter, naming and required skill set.

## Connector model

The portable plugin includes only the verified Vercel MCP endpoint. GitHub and Supabase access should use the user's approved client apps/connectors or a separately reviewed MCP connection. Do not embed provider credentials in `mcp.json`; Agent Plugins v1 does not define portable secret placeholders for remote MCP headers.

## Release philosophy

Read/research can be broad. Writes become progressively constrained with risk. Branch/preview work is preferred; production and destructive operations require explicit human release decisions and a rollback path.
