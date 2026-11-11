# @mongodb-js/atlas-query-insights-agent

Library for the Atlas Query Insights agent's behavior: policies, prompts,
and middleware.

Shared LLM selection, checkpoints, and LangGraph middleware live in
[`@mongodb-js/agent-engine-core`](../agent-engine-core). The deployable app is
[`agents/atlas-query-insights`](../../agents/atlas-query-insights).

`ATLAS_QUERY_INSIGHTS_MCP_TOOLS` is the subset of Atlas MCP tools this agent may
call. `ALLOW_WRITE_OPERATIONS` is ignored. `aggregate` stays available for
read pipelines. A pipeline that contains `$out` or `$merge` is rejected
because this agent is read-only.

## Install

```bash
npm install @mongodb-js/atlas-query-insights-agent langchain @langchain/core @langchain/langgraph zod \
  @mongodb-js/agent-engine-sdk @mongodb-js/agent-engine-runner-shared \
  @mongodb-js/mcp-tools-assistant
```

`langchain` is a peer dependency. The others are peers of
`@mongodb-js/agent-engine-core`, which installs with this package.

This package is at `0.x`. Its API is unstable and can change in any release.

## Skills

`skills/` holds the 5 MongoDB Agent Skills this agent uses, and ships in the
npm package. `skills.config.json` lists them, and
`pnpm update-skills packages/atlas-query-insights-agent` refreshes them from
[`mongodb/agent-skills`](https://github.com/mongodb/agent-skills).

[`agents/atlas-query-insights`](../../agents/atlas-query-insights) keeps a copy in its own `skills/`,
because Agent Engine reads skills from the agent root. A test in that agent
fails if the copy differs from this one.
