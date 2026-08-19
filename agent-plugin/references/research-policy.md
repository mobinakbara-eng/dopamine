# Research and Evidence Policy

## When the 7-evidence gate applies
Use it for meaningful feature design, architecture, library choice, security/auth changes, database changes, new workflow design, competitor-informed UX and any change with uncertain current APIs or product conventions.

Minor typo fixes, deterministic local refactors and direct test repairs do not require seven external sources, but still require repository inspection.

## Evidence mix
Target at least seven relevant evidence items:
- >=2 AORA source/test/doc artifacts.
- >=2 primary technical sources: official docs, specifications or source code.
- >=2 competitor/product examples when the task is product/UX oriented.
- >=1 security, privacy, accessibility or standards source when applicable.

Seven weak sources do not beat three authoritative ones. The numeric gate is a floor for breadth, not permission to lower source quality.

## Research record
For each material claim capture:
- source/title
- publication or update date when available
- exact question answered
- primary vs secondary
- applicability to current AORA stack
- confidence
- conflicts/limitations

## Competitor research rule
Do not copy pixels or workflows blindly. Extract:
- user problem
- actor/role
- trigger
- minimum steps
- defaults and automation
- error recovery
- permission boundary
- mobile behavior
- notable friction
- what should NOT be copied

Then design the AORA-native workflow from those principles.
