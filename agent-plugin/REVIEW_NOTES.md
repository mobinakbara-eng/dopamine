# Review Notes

Focus review on behavior of the guidance layer rather than application code, because this PR intentionally does not modify AORA runtime files.

High-signal review areas:
- whether the 7-evidence rule is appropriately scoped to meaningful work rather than trivial edits
- whether R0-R5 risk levels create sufficient production protection without blocking normal branch/preview work
- whether tenancy rules preserve workspace/location/identity/device boundaries
- whether inventory event-ledger guidance matches the intended product direction
- whether root `AGENTS.md` should be enabled for all future coding-agent sessions after merge
- whether the Vercel MCP should remain generic or later be replaced with an explicitly resolved project-scoped endpoint
