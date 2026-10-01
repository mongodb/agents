---
name: mongodb-mcp-setup
description: Diagnose MongoDB Managed MCP startup and authentication for Atlas Explorer on Agent Engine. Use when MongoDB tools are unavailable, Atlas authentication fails, or an operator asks how this agent obtains MCP access. Never request or expose credential values.
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# MongoDB Managed MCP Setup

Atlas Explorer owns its MongoDB MCP configuration. Do not guide users through
configuring a separate desktop or shell MCP client, connection-string mode, or
Atlas Local. Agent Engine discovers the remote tools and routes every call through
its Tool Pod.

## Runtime contract

Operators provide these secrets through the Agent Engine secret store, or through
the agent's local `.env` file:

- `ATLAS_ORG_ID`
- `ATLAS_PUBLIC_API_KEY`
- `ATLAS_PRIVATE_API_KEY`

Each AER and Tool Pod process then:

1. Resolves its public IPv4 egress address.
2. Uses Atlas Admin API Digest authentication to create a uniquely named
   organization MCP configuration with that IP allowlisted.
3. Generates the configuration's one-time client secret.
4. Keeps the generated client ID and secret only in process memory.
5. Lets Agent Engine's native MCP client obtain short-lived OAuth tokens and expose
   tools with names such as `mongodb__atlas_list_projects`.

Never ask the user to paste secret values into chat. Never print generated
client secrets or access tokens.

## Diagnose unavailable tools

1. Check whether server-prefixed tools such as
   `mongodb__atlas_list_projects`, `mongodb__list_databases`, and
   `mongodb__find` are available.
2. If the entire `mongodb__*` family is missing, report a startup or MCP
   discovery failure. Ask the operator to inspect AER and Tool Pod startup logs.
3. If startup reports missing Atlas Admin API variables, identify the missing
   secret names only. Do not request their values.
4. If Atlas rejects MCP configuration creation, ask the operator to verify that
   the programmatic API key belongs to `ATLAS_ORG_ID`, can create organization
   MCP configurations, and permits the runtime's egress address.
5. If OAuth token discovery fails, ask the operator to restart the affected
   runtime. A restart deliberately creates a fresh MCP identity and one-time
   secret.
6. Do not fall back to raw MCP calls in the AER or to local-only Atlas tools.

## Local operator workflow

```bash
cp env.example .env
# Set the three ATLAS_* Admin API values and an LLM provider key in .env.
agentengine dev up
```

The operator must not set `ATLAS_MCP_CLIENT_ID` or
`ATLAS_MCP_CLIENT_SECRET`; Atlas Explorer generates them during process
startup. Use `agentengine dev logs` to confirm that both runtime processes created
distinct `atlas-explorer-*` identities and that MongoDB tools were registered.

## Recovery guidance

- Missing Admin API secrets: add the named Agent Engine secrets, then restart.
- Atlas Digest authorization failure: verify organization, key permissions,
  and API access policy.
- Public IPv4 discovery failure: restore outbound HTTPS access to one of the
  configured IPv4 discovery services.
- MCP config or secret creation failure: fix the reported Atlas API error and
  restart; do not persist partial credentials.
- Tool validation or query failure after discovery: correct the tool arguments
  and retry. Do not rotate credentials for an ordinary query error.
