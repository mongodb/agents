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

The package ships the 5 MongoDB Agent Skills that Atlas Query Insights uses, in
`skills/`. Agent Engine reads an agent's skills from `<agent root>/skills`, so
copy them there in your agent's `build` script:

```json
{
  "scripts": {
    "build": "tsc && atlas-query-insights-agent sync-skills"
  }
}
```

Then add `skills/` to your agent's `.gitignore`.

- `sync-skills` replaces each bundled skill directory and leaves other
  directories in `./skills` alone. If you keep your own skills there too,
  ignore only the bundled ones, such as `skills/mongodb-*/`.
- `--dir <path>` copies the skills somewhere other than `./skills`.
- Run it from `build`, not `postinstall`. `agentengine` container builds
  block install scripts, but they run `npm run build` and keep its output in
  the image.
- Skill updates ship as new releases of this package.

In this repository, `skills.config.json` lists the skills, and
`pnpm update-skills packages/atlas-query-insights-agent` refreshes them from
[`mongodb/agent-skills`](https://github.com/mongodb/agent-skills).
[`agents/atlas-query-insights`](../../agents/atlas-query-insights) keeps a committed
copy, because a deploy builds it without the workspace packages. Its
`pnpm build` runs `sync-skills` to refresh that copy, and a test fails if the
two differ.
