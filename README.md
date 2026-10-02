# MongoDB Agent Engine agents

A pnpm monorepo of MongoDB and Atlas agents that run on Agent Engine, plus the
shared libraries and chat clients that go with them. It is not a template
repository: each agent is a workspace you build, test, and deploy from here.

## Layout

| Path | What it is |
| --- | --- |
| [`agents/atlas-explorer`](agents/atlas-explorer/README.md) | The Atlas Explorer agent: a deployable Agent Engine app with `agent.yaml`, skills, and the esbuild bundle. |
| [`apps/atlas-explorer-slack-bot`](apps/atlas-explorer-slack-bot/README.md) | The `@AtlasExplorer` Slack client, run locally with Socket Mode or deployed to Vercel. |
| [`packages/agent-engine-core`](packages/agent-engine-core/README.md) | Shared Agent Engine runtime: LLM selection, tool policy, and LangGraph middleware. |
| [`packages/atlas-explorer-agent`](packages/atlas-explorer-agent/README.md) | Atlas Explorer's tool allowlist, prompts, and middleware. |
| [`packages/query-analysis-agent`](packages/query-analysis-agent/README.md) | The Query Analysis agent's read-only tool policy. |
| [`packages/agent-engine-chat`](packages/agent-engine-chat/README.md) | Chat SDK client library for any Agent Engine agent: handlers, Agent Engine client, and thread storage. |
| [`scripts/seed-pa-slow-queries`](scripts/seed-pa-slow-queries/README.md) | A script that loads slow-query data into an Atlas cluster for Performance Advisor. It drops the `highImpact` database. |
| [`agent.yaml`](agent.yaml) | Agent Engine monorepo manifest. Each entry is a workspace under `agents/`. |
| [`project-config.yaml`](project-config.yaml) | Project-level Agent Engine settings, currently memory. |
| [`.agentengineignore`](.agentengineignore) | Files left out of the source archive that `agentengine build` uploads. |
| [`.agents/skills`](.agents/skills) | Coding-agent skills for this repository, including the Agent Engine skills from the `agentengine` CLI. |
| [`.cursor`](.cursor/environment.json) | Cursor Cloud Agent environment: installs Docker and the `agentengine` CLI. |
| [`.github`](.github) | CI workflows, the shared unit-test action, and the pull request template. |

`tsconfig.base.json`, `tsconfig.test.base.json`, and `vitest.shared.mts` hold
the TypeScript and Vitest settings that every package extends.

The libraries are consumed from their compiled `dist` folders, so each
consumer's `pre*` scripts build them first.

## Prerequisites

- [pnpm](https://pnpm.io) 11.25.0, as pinned by `packageManager` in
  `package.json`. `corepack enable` provides it.
- Node.js, with the version depending on what you run:
  - 24 or newer for `agents/atlas-explorer`, `@repo/atlas-explorer-agent`,
    `@repo/agent-engine-core`, and `@repo/query-analysis-agent`.
  - 22.x for `apps/atlas-explorer-slack-bot`. Its `engines` field is what
    Vercel reads.
  - 22 or newer for `@repo/agent-engine-chat` and the repository root.

  pnpm prints an "Unsupported engine" warning if a package's range is not
  met. CI uses Node 24 for every package.
- The `agentengine` CLI and Docker, to run an
  agent locally with `agentengine dev up` or to build and deploy it. The
  [Cloud Agent install script](.cursor/install.sh) shows how the CLI is
  installed.
- `mongosh`, only for the seed script.

## Getting started

```bash
corepack enable
pnpm install
pnpm test:atlas-explorer
pnpm test:slack-bot
```

Then follow the README of the piece you are working on, which covers its
configuration, local development, and deployment. Start with
[Atlas Explorer](agents/atlas-explorer/README.md) for the agent, or the
[Slack bot](apps/atlas-explorer-slack-bot/README.md) for the chat client.

To run an Agent Engine workspace from the repository root, pass its name from
the root [`agent.yaml`](agent.yaml):

```bash
agentengine dev up --workspace atlas-explorer
```

From `agents/atlas-explorer`, `agentengine dev up` uses the same project config.

## Root scripts

Run these from the repository root.

| Script | What it does |
| --- | --- |
| `pnpm test:atlas-explorer` | Tests `@repo/agent-engine-core`, `@repo/atlas-explorer-agent`, and `atlas-explorer`. |
| `pnpm test:slack-bot` | Tests `@repo/agent-engine-chat` and `@repo/atlas-explorer-slack-bot`. |
| `pnpm test:query-analysis` | Tests `@repo/query-analysis-agent`. |
| `pnpm build:atlas-explorer` | Builds `atlas-explorer` and the workspace packages it depends on. |
| `pnpm build:slack-bot` | Builds `@repo/atlas-explorer-slack-bot` and the workspace packages it depends on. |

Each package also has its own `test` and `typecheck` scripts, run with
`pnpm --filter <package> <script>`.

## Continuous integration

Two GitHub Actions workflows run unit tests on pull requests and on pushes to
`main`. Each runs only when files it covers change, such as its packages, the
lockfile, the shared TypeScript and Vitest config, or the workflow itself.

| Workflow | Runs |
| --- | --- |
| [`unit-tests-agents.yml`](.github/workflows/unit-tests-agents.yml) | One job each for `@repo/agent-engine-core`, `@repo/atlas-explorer-agent`, `atlas-explorer`, and `@repo/query-analysis-agent`. |
| [`unit-tests-slack-bot.yml`](.github/workflows/unit-tests-slack-bot.yml) | One job each for `@repo/agent-engine-chat` and `@repo/atlas-explorer-slack-bot`. |

Both use the [`unit-test`](.github/actions/unit-test/action.yml) action, which
installs dependencies with `pnpm install --frozen-lockfile` on Node 24 and runs
the package's test script. CI does not run typecheck or build.
