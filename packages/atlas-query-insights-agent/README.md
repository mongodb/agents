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

### Skills

This package bundles Atlas Query Insights' five MongoDB Agent Skills and ships
an `atlas-query-insights-agent sync-skills` CLI that copies them into
`./skills`.

Agent Engine container builds do not copy a repository `skills/` folder and
skip `postinstall` scripts, while `npm run build` runs during image assembly
and persists `/app/skills` into the image. Wire `sync-skills` into your
agent's `build` script and ignore `skills/` in git:

```json
{
  "scripts": {
    "build": "tsc && atlas-query-insights-agent sync-skills"
  }
}
```

Add `skills/` to `.gitignore`. Skill updates ship as releases of this package.
