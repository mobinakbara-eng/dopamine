---
name: aora-vercel-operations
description: Inspect AORA Vercel projects, deployments, logs, preview behavior and release status using current Vercel tooling. Use for deployment failures, preview verification, runtime logs, Vercel configuration or release operations.
---

# AORA Vercel Operations

Use the official Vercel MCP/client connector when available. The portable plugin declares the generic endpoint; resolve team/project from authenticated tooling rather than guessing.

## Investigation order
- identify project/team and environment
- identify deployment/source SHA/branch
- inspect build/deployment status
- inspect relevant runtime/build logs
- compare with last known-good deployment
- correlate with recent commits/config changes

Prefer preview for feature validation. Production rollback must target a known-good deployment and account for database compatibility; rolling back frontend code cannot undo a destructive schema change.

Do not expose environment secrets in logs or responses.
