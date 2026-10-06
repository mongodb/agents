# @repo/agent-engine-core

Shared Agent Engine runtime used by the agent templates: LLM selection, tool
selection, requester metadata, and LangGraph middleware. `redactSecretsMiddleware`
strips common credentials from model replies before they are checkpointed.

Agent-specific prompts and tool allowlists stay in the agent package. Atlas
Explorer's package is [`@repo/atlas-explorer-agent`](../atlas-explorer-agent).
