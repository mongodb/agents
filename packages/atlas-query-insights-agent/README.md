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
npm install @mongodb-js/atlas-query-insights-agent
```

Peer dependencies are installed automatically by npm 7 and later.

## Skills

`skills/` holds the MongoDB Agent Skills this agent uses, and ships in the
npm package. `skills.config.json` lists them, and
`pnpm update-skills packages/atlas-query-insights-agent` refreshes them from
[`mongodb/agent-skills`](https://github.com/mongodb/agent-skills).
