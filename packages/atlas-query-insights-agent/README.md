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

Installing the package does not create `./skills`. Run `sync-skills` in your
agent's `build` script to copy the bundled skills there.

The package ships the MongoDB Agent Skills that Atlas Query Insights uses, in
`skills/`. Agent Engine reads an agent's skills from `<agent root>/skills`:

```json
{
  "scripts": {
    "build": "tsc && atlas-query-insights-agent sync-skills"
  }
}
```

Then add `skills/` to your agent's `.gitignore`. The generated `skills/` folder
must be in the folder you upload when you build or deploy the agent.

To try it by hand, run `npx atlas-query-insights-agent sync-skills`
in your agent's root.

- `sync-skills` replaces each bundled skill directory and leaves other
  directories in `./skills` alone. If you keep your own skills there too,
  ignore only the bundled ones, such as `skills/mongodb-*/`.
- `--dir <path>` copies the skills somewhere other than `./skills`.
- Run it from `build`, not `postinstall`, so it also works where install
  scripts are disabled. `agentengine` image builds run `npm run build` and
  keep its output in the image.
- Skill updates ship as new releases of this package.

In this repository, `skills.config.json` lists the skills, and
`pnpm update-skills packages/atlas-query-insights-agent` refreshes them from
[`mongodb/agent-skills`](https://github.com/mongodb/agent-skills).
[`agents/atlas-query-insights`](../../agents/atlas-query-insights) generates its `skills/` from this
package when you run `pnpm build`, and git-ignores it.
