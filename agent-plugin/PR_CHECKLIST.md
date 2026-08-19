# AORA Plugin PR Checklist

## Portable package
- [ ] `plugin.json` matches Agent Plugins 1.0.0 schema.
- [ ] `mcp.json` matches the same spec version.
- [ ] No credentials or secrets are stored in plugin/MCP files.
- [ ] Every immediate `skills/*` directory contains a valid `SKILL.md`.
- [ ] Skill `name` matches its directory and description contains clear routing triggers.

## AORA safety
- [ ] No `aora-v8-final/app` runtime file is changed by this plugin PR.
- [ ] No Supabase migration/function is changed by this plugin PR.
- [ ] No Vercel production configuration is changed by this plugin PR.
- [ ] `AGENTS.md` preserves existing architecture, tenancy, security and release gates.
- [ ] R3+ work requires staging/rollback evidence; R4/R5 requires explicit release gating.

## Validation
- [ ] Run `cd agent-plugin && npm run validate` in a checked-out repository.
- [ ] Run routing/safety evals in the target client when available.
- [ ] Test at least one read-only AORA prompt before enabling writes.
- [ ] Confirm Vercel MCP OAuth succeeds in the target client before relying on deployment tools.

## Merge
- [ ] Review the root-level `AGENTS.md` because it becomes persistent agent guidance after merge.
- [ ] Review app/connector permissions separately; the plugin must not grant broader source-system access.
- [ ] Keep the PR draft until validation and permission review are complete.
