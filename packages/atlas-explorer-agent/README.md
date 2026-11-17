# @mongodb-js/atlas-explorer-agent

Library for Atlas Explorer's agent behavior. The deployable app lives
in [`agents/atlas-explorer`](../../agents/atlas-explorer).

## Install

```bash
npm install @mongodb-js/atlas-explorer-agent
```

Peer dependencies are installed automatically by npm 7 and later.

## What's in it

- **Tool policy.** The read-only Atlas MCP allowlist, which tools are exposed,
  and which tools need approval. Writes stay off unless
  `ALLOW_WRITE_OPERATIONS` is set to something other than empty or `false`.
  Database-user creation and access-list changes stay hidden in both modes
  (`HIGH_RISK_MCP_TOOLS`). Other tools the Atlas MCP server adds later are
  still exposed when writes are on.
- **System prompts.** Read-only and write-enabled prompts, with an optional
  agent name and custom instructions.
- **Skills.** The MongoDB Agent Skills the agent uses. See [Skills](#skills).
- **Shared runtime.** Re-exports from
  [`@mongodb-js/atlas-agents-core`](../atlas-agents-core): LLM selection, agent
  input, requester metadata, resume handling, and LangGraph middleware.

## Skills

Installing the package does not create `./skills`. Run `sync-skills` in your
agent's `build` script to copy the bundled skills there.

The package ships the MongoDB Agent Skills that Atlas Explorer uses, in
`skills/`. Agent Engine reads an agent's skills from `<agent root>/skills`:

```json
{
  "scripts": {
    "build": "tsc && atlas-explorer-agent sync-skills"
  }
}
```

Then add `skills/` to your agent's `.gitignore`. The generated `skills/` folder
must be in the folder you upload when you build or deploy the agent.

To try it by hand, run `npx atlas-explorer-agent sync-skills`
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
`pnpm update-skills packages/atlas-explorer-agent` refreshes them from
[`mongodb/agent-skills`](https://github.com/mongodb/agent-skills).
[`agents/atlas-explorer`](../../agents/atlas-explorer) generates its `skills/` from this
package when you run `pnpm build`, and git-ignores it.

## Build and test

From the repository root, with Node.js 24 or newer:

```bash
pnpm install
pnpm --filter @mongodb-js/atlas-explorer-agent build
pnpm --filter @mongodb-js/atlas-explorer-agent test
```

`build` and `test` build `@mongodb-js/atlas-agents-core` first. `typecheck`
type-checks sources and tests without emitting files. `test:watch` runs the
tests in watch mode.
