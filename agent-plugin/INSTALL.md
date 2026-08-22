# Installation and Use

## Portable Agent Plugin

The repository root is the plugin root. A compatible Agent Plugins client discovers:

- `plugin.json`
- `skills/*/SKILL.md`
- `mcp.json`

Install or load this repository using the plugin workflow supported by your client. If using a client that supports the Agent Plugins CLI ecosystem, point it at `mobinakbara-eng/dopamine` and review the plugin before enabling it.

## ChatGPT / Codex

OpenAI plugins can package skills and apps. The portable AORA package intentionally keeps provider credentials out of source and relies on the user's approved app/connector permissions. The Vercel MCP endpoint in `mcp.json` requires client-managed authentication.

## Vercel MCP

The configured endpoint is:

```text
https://mcp.vercel.com
```

When a specific Vercel Team/Project is known and authenticated, a project-specific Vercel MCP URL can be configured by the user/client for stronger context. Do not guess or hard-code project identifiers.

## GitHub and Supabase

Use approved GitHub and Supabase apps/connectors with least privilege. Prefer read-only access for inspection and branch/PR-scoped writes for implementation. Production database writes remain gated by the AORA risk policy.

## Recommended first test prompts

1. `Review the current AORA inventory architecture without making changes.`
2. `Check whether Manager permissions are correctly location-scoped and report evidence only.`
3. `Plan a safe inventory stock-movement migration but do not execute it.`
4. `Review this branch for release readiness; do not merge.`

These tests verify routing and safety before granting broader write permissions.
