# Connector Policy

## Portable plugin
The root `mcp.json` contains only the verified Vercel remote MCP endpoint using Streamable HTTP. Agent Plugins v1 leaves OAuth discovery and credential storage to the client.

## GitHub
Prefer an approved GitHub app/connector with repository-scoped access. Read operations can be broad enough for investigation; write operations should be limited to the target repository and branch/PR workflow. Do not require a standing personal access token in the repository.

## Supabase
Prefer an approved Supabase connector or a reviewed MCP integration. Use read-only/schema access for analysis when possible. Separate staging and production credentials/projects. Production write or migration capability is R4/R5 depending on destructiveness.

## Vercel
The official MCP endpoint is `https://mcp.vercel.com`. Prefer project-specific context when the client/user has explicitly resolved team and project; otherwise keep the generic endpoint and let the authenticated client select context.

## Vercel Connect
For agents deployed on Vercel that need provider APIs, prefer runtime short-lived scoped tokens and environment-specific connector links over long-lived secrets. Request the minimum provider scopes/resources required for the current action.
