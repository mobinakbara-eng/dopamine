# Evidence Sources Used for Plugin 0.1.0

The initial plugin design was checked against current source and platform documentation on 2026-08-19.

## Repository evidence
- `aora-v8-final/README.md`: active build path, roles, architecture, environments, security and QA model.
- `aora-v8-final/package.json`: current version, Node requirement and validation command ladder.
- Current `main` head at creation: `b7f7fa009fce344ecc387564f965237aaba094fe`.

## Agent Plugins / Skills
- Agent Plugins Specification 1.0.0: portable `plugin.json`, fixed `skills/` discovery and `mcp.json` rules.
- Agent Plugins canonical manifest and MCP JSON schemas.
- Agent Skills format guidance: `SKILL.md`, required `name`/`description`, progressive disclosure and optional references/scripts/assets.

## OpenAI
- Current OpenAI Help guidance: plugins can package skills and apps; source-system permissions remain authoritative.
- Current Skills guidance: reusable skills can contain instructions, examples and code and follow the Agent Skills open standard.

## Vercel
- Official Vercel MCP endpoint and supported ChatGPT/Codex client guidance.
- Vercel Connect guidance for short-lived, scoped runtime credentials and environment isolation.

## Design consequence
The plugin intentionally separates procedural guidance (skills) from external capabilities (client-approved connectors/MCP) and does not embed provider credentials. The active AORA runtime is not modified by plugin version 0.1.0.
