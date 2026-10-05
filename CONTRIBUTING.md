# Contributing to MongoDB Agents

This repository is a pnpm monorepo of MongoDB agents that run on
[Atlas Agent Engine](https://www.mongodb.com/docs/agentengine/), plus the
shared libraries and chat clients that go with them.

To report a bug or suggest an agent,
[open an issue](https://github.com/mongodb/agents/issues).

## Repository layout

| Path | What it is |
| --- | --- |
| [`agents/`](agents) | Deployable agents, one workspace each, such as `atlas-explorer` and `atlas-query-insights`. |
| [`apps/`](apps) | Chat clients, such as the example Slack bot. |
| [`packages/`](packages) | Shared libraries. Each agent's prompts, tool policy, and middleware live in its own package, built on `@repo/agent-engine-core`. |
| [`scripts/`](scripts) | Helper scripts, such as a seeder that creates slow queries for Performance Advisor. |
| [`agent.yaml`](agent.yaml) | Registers each agent workspace with Agent Engine. |

Apps import each library's compiled `dist` folder. The `test`, `build`, and
`typecheck` scripts build the libraries first. If you run `vitest` or `tsc`
directly, build the libraries yourself first.

## Set up

You need:

- Node.js 24 or later (the Slack bot targets Node.js 22)
- pnpm. Run `corepack enable` to get the version pinned in `package.json`.
- The [`agentengine` CLI](https://www.mongodb.com/docs/agentengine/build/install-authenticate/)
  and Docker, to run or deploy an agent

Then install and run the tests:

```bash
corepack enable
pnpm install
pnpm test:atlas-explorer
```

Each agent has `pnpm test:<agent>` and `pnpm build:<agent>` scripts at the
repository root, such as `pnpm test:atlas-query-insights`. Each package also has its
own `test` and `typecheck` scripts. Run them with
`pnpm --filter <package> <script>`.

To run an agent locally, run `agentengine dev up` from its directory, or from
the repository root with `--workspace <name>`. For configuration, see the
agent's README.

## Pull requests

- Fill in the [pull request template](.github/pull_request_template.md).
- Keep each pull request focused on one change.
- CI runs unit tests only. Run `typecheck` and `build` locally before you open
  a pull request.
- Don't edit `.agentengine/`. The `agentengine` CLI generates it.
