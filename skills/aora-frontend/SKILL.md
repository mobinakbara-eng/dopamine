---
name: aora-frontend
description: Implement or review AORA browser UI and ES-module frontend changes while preserving existing role navigation, state ownership, responsiveness, accessibility and performance. Use for changes under the active AORA app frontend.
---

# AORA Frontend

Before editing, locate the existing module/style/pattern that owns the behavior.

## Rules
- Extend current role-specific surfaces; do not create a parallel app shell.
- Keep a single authoritative state path for each workflow.
- Treat backend success as distinct from UI synchronization; update/revalidate deterministically.
- Escape user-controlled stored content according to existing project patterns.
- Preserve canonical URL/environment behavior for public links.
- Avoid unnecessary dependencies and global CSS leakage.
- Check narrow mobile layout, horizontal overflow, keyboard navigation and focus after modal/dialog actions.
- Implement explicit loading/empty/error/retry states for async workflows.

For stateful mutations, pair with the owning backend/tenancy skill and verify persisted state, not only DOM state.
