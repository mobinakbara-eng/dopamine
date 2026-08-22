---
name: aora-project-context
description: Establish the current AORA repository, architecture, version, active build path, roles, environments and available tests before consequential work. Use at the start of significant AORA engineering tasks or whenever prior project assumptions may be stale.
---

# AORA Project Context

Never rely only on remembered project state.

## Verify
- repository default branch and recent relevant commits
- active AORA source tree and build path
- `README.md`, `package.json`, build scripts and `vercel.json`
- relevant Supabase migrations/functions
- existing tests for the affected feature
- current role/navigation model
- environment and canonical-origin contracts

Use `agent-plugin/references/architecture.md` as a checklist, then correct it mentally if repository evidence differs.

## Context snapshot
Before R2+ work, be able to state:
- active source path
- affected module files
- current behavior
- relevant tests
- data/backend owner
- affected roles
- affected tenant/location/device boundaries
- environment impact

If the repository changed since the reference was written, follow the repository and note the stale reference for `aora-documentation-sync`.
