# Managed MCP Troubleshooting

Atlas Explorer receives Atlas Stream Processing tools through Agent Engine's native
MongoDB Managed MCP registration. Do not install or configure a separate MCP
server, invoke the Atlas API outside the Tool Pod, or fall back to unaudited
local commands.

## Verify tool discovery

Confirm that all four server-prefixed tools are available:

- `mongodb__atlas_streams_discover`
- `mongodb__atlas_streams_build`
- `mongodb__atlas_streams_manage`
- `mongodb__atlas_streams_teardown`

If every `mongodb__*` tool is missing, treat this as process-startup or MCP
discovery failure. Follow the `mongodb-mcp-setup` skill and ask the operator to
inspect both AER and Tool Pod startup logs.

If MongoDB tools exist but the Streams tools are absent, report a Managed MCP
capability/version mismatch. Do not emulate the missing write tools with shell
commands or raw HTTP requests.

## Diagnose authentication failures

- Missing `ATLAS_ORG_ID`, `ATLAS_PUBLIC_API_KEY`, or
  `ATLAS_PRIVATE_API_KEY`: identify only the missing secret names and ask the
  operator to configure them in Agent Engine.
- Atlas Admin API authorization failure during startup: verify that the key
  belongs to the configured organization and can create organization MCP
  configurations.
- MCP OAuth failure after startup: restart the affected runtime so it creates
  a fresh process identity and one-time secret.
- 401/403 during a Streams call: inspect startup and Tool Pod logs before
  changing configuration. Never request, print, or persist credential values.

## Diagnose tool-call failures

- Validation error: correct the action-specific arguments and retry.
- Missing project ID: call `mongodb__atlas_list_projects`.
- Missing workspace or resource name: use
  `mongodb__atlas_streams_discover` to list and inspect the parent resources.
- Permission or feature error from a correctly authenticated tool: report the
  Atlas response and required capability; do not bypass Tool Pod routing.

The read-only discover tool is safe for diagnostics. The manage and teardown
tools remain subject to Agent Engine's approval interrupt.
