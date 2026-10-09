# @repo/agent-engine-core

Shared Agent Engine runtime used by the agent templates: LLM selection, tool
selection, requester metadata, and LangGraph middleware.
`redactSecretsMiddleware` strips common credentials from model replies before
they are checkpointed. `approveAggregateWritesMiddleware` requires HITL
approval for `mongodb__aggregate` and `mongodb__aggregate_db` when the
pipeline contains `$out` or `$merge`. `rejectAggregateWritesMiddleware`
rejects those calls for a read-only agent. `surfaceTokenMintFailures` wraps the
app's `ready()`, where each agent and tool process mints its Atlas MCP access
token. If Atlas refuses the token, the wrapper rethrows the failure as
`McpTokenLimitError` naming the runtime and the limit, so the logs say why
startup failed. It does not recover from the failure.

Agent-specific prompts and tool allowlists stay in the agent package. Atlas
Explorer's package is [`@repo/atlas-explorer-agent`](../atlas-explorer-agent).
