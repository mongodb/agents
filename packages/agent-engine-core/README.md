# @repo/agent-engine-core

Shared Agent Engine runtime used by the agent templates: LLM selection, tool
selection, requester metadata, and LangGraph middleware.
`approveAggregateWritesMiddleware` suspends `mongodb__aggregate` and
`mongodb__aggregate_db` when the pipeline contains `$out` or `$merge`.

Agent-specific prompts and tool allowlists stay in the agent package. Atlas
Explorer's package is [`@repo/atlas-explorer-agent`](../atlas-explorer-agent).
