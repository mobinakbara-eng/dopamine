---
name: aora-documentation-sync
description: Keep AORA README, architecture, environment, permission, migration, QA and release documentation aligned with verified implementation. Use after behavior/architecture changes or when docs appear stale.
---

# AORA Documentation Sync

Documentation must describe verified behavior, not aspirational features.

Check whether changes require updates to:
- project README/version
- architecture/source path
- role permissions/navigation
- environment variables and deployment contract
- database/migration notes
- test commands/coverage
- operational runbooks and release notes
- plugin references if architecture assumptions changed

If no documentation change is needed, record `documentation-impact: none` in the change/release notes rather than silently ignoring the question.
