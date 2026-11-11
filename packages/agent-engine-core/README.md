# @mongodb-js/agent-engine-core

Shared Agent Engine runtime used by the agent templates: LLM selection, tool
selection, requester metadata, and LangGraph middleware.
`redactSecretsMiddleware` strips common credentials from model replies and tool
messages before they are checkpointed. `createInputRedactor` redacts secrets from
the user's message in `prepareAgentInput`, and `createInputRefusalMiddleware`
refuses messages that are too long to screen; see
[Input guard](./src/inputGuard.ts). `clusterAllowlistMiddleware` rejects
MongoDB MCP calls that name a project or cluster outside the agent's
`dataAccess` config. `databaseAllowlistMiddleware` rejects MongoDB MCP
calls whose `database` argument, or `$out` or `$merge` target, is outside the
agent's `dataAccess.databaseNames` config. `approveAggregateWritesMiddleware` requires HITL
approval for `mongodb__aggregate` and `mongodb__aggregate_db` when the
pipeline contains `$out` or `$merge`. `rejectAggregateWritesMiddleware`
rejects those calls for a read-only agent. `surfaceTokenMintFailures` wraps the
app's `ready()`, where each agent and tool process mints its Atlas MCP access
token. If Atlas refuses the token, the wrapper rethrows the failure as
`McpTokenLimitError` naming the runtime and the limit, so the logs say why
startup failed. It does not recover from the failure.

`syncSkills` and `runSkillsCli`, exported from
`@mongodb-js/agent-engine-core/sync-skills`, copy a package's bundled skills
into an agent's `skills/` directory. The agent packages' `sync-skills`
commands use them. That entry point does not load LangChain.

Agent-specific prompts and tool allowlists stay in the agent package. Atlas
Explorer's package is [`@mongodb-js/atlas-explorer-agent`](../atlas-explorer-agent).

## Install

```bash
npm install @mongodb-js/agent-engine-core @langchain/core @langchain/langgraph langchain zod \
  @mongodb-js/agent-engine-sdk @mongodb-js/agent-engine-runner-shared \
  @mongodb-js/mcp-tools-assistant
```

The SDK, LangChain, and `zod` packages are peer dependencies, so your agent
and this package share one copy of each.

This package is at `0.x`. Its API is unstable and can change in any release.
