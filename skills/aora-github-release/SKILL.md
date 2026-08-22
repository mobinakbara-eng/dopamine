---
name: aora-github-release
description: Manage AORA engineering changes through GitHub branches, intentional commits, pull requests, review evidence and merge readiness without bypassing main-branch safety. Use when publishing code changes, preparing a PR or assessing merge readiness.
---

# AORA GitHub Release

## Branch discipline
- Start feature/fix work from the current default branch unless the task explicitly targets another base.
- Use `agent/<short-description>` for agent-created branches.
- Never silently mix unrelated working-tree changes into the same commit/PR.
- Do not push feature work directly to `main`.

## PR evidence
A PR should explain:
- outcome and why
- root cause for fixes
- important files/subsystems changed
- affected roles and boundaries
- migrations/config changes
- tests/checks actually executed
- preview/staging evidence when applicable
- security/tenancy impact
- known limitations
- rollback plan for R3+

## Merge readiness
Do not equate “PR exists” with “safe to merge.” Confirm required CI/checks, unresolved review feedback, migration ordering, environment configuration and release gates appropriate to risk.

Default agent-created PRs to draft unless the user explicitly asks for ready-for-review and the evidence is complete.
