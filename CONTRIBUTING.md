# Contributing

## Prerequisites

- [pnpm](https://pnpm.io) 11.25.0, as pinned by `packageManager` in
  `package.json`. `corepack enable` provides it.
- Node.js 24 or newer for `agents/atlas-explorer`, `@repo/agent-engine-core`,
  `@repo/atlas-explorer-agent`, and `@repo/query-analysis-agent`. The Slack bot
  declares Node 22.x (Vercel reads that), and `@repo/agent-engine-chat` and the
  repository root accept 22 or newer. pnpm warns when a package's range is not
  met. CI uses Node 24 for everything.
- The `agentengine` CLI and Docker, to run an agent locally with
  `agentengine dev up` or to build and deploy it. The Cloud Agent
  [install script](.cursor/install.sh) shows how the CLI is installed.

## Install

```bash
corepack enable
pnpm install
```

## Scripts

Run these from the repository root.

| Script | Covers |
| --- | --- |
| `pnpm test:atlas-explorer` | `@repo/agent-engine-core`, `@repo/atlas-explorer-agent`, `atlas-explorer` |
| `pnpm test:slack-bot` | `@repo/agent-engine-chat`, `@repo/atlas-explorer-slack-bot` |
| `pnpm test:query-analysis` | `@repo/query-analysis-agent` |
| `pnpm build:atlas-explorer` | `atlas-explorer` and the packages it depends on |
| `pnpm build:slack-bot` | `@repo/atlas-explorer-slack-bot` and the packages it depends on |

Each package also has `test` and `typecheck` scripts, run with
`pnpm --filter <package> <script>`.

The libraries are consumed from their compiled `dist` folders, so a consumer's
`pre*` scripts build them first. If you run `vitest` or `tsc` directly, build
the libraries yourself.

To run an agent locally from the repository root, pass its name from the root
`agent.yaml`:

```bash
agentengine dev up --workspace atlas-explorer
```

## Repository configuration

- `agent.yaml` registers each Agent Engine workspace under `agents/`.
- `project-config.yaml` holds project-level Agent Engine settings, currently
  memory.
- `.agentengineignore` lists what `agentengine build` leaves out of the
  uploaded source.
- `tsconfig.base.json`, `tsconfig.test.base.json`, and `vitest.shared.mts` are
  the shared TypeScript and Vitest settings that packages extend.
- `.agents/skills` holds coding-agent skills for this repository, including the
  Agent Engine skills that the `agentengine` CLI installs.

## Continuous integration

Two workflows in [`.github/workflows`](.github/workflows) run unit tests on
pull requests and on pushes to `main`, when files they cover change:

- `unit-tests-agents.yml`: one job each for `@repo/agent-engine-core`,
  `@repo/atlas-explorer-agent`, `atlas-explorer`, and
  `@repo/query-analysis-agent`.
- `unit-tests-slack-bot.yml`: one job each for `@repo/agent-engine-chat` and
  `@repo/atlas-explorer-slack-bot`.

Both use the shared [`unit-test`](.github/actions/unit-test/action.yml) action,
which installs with `pnpm install --frozen-lockfile` and runs the package's
test script. CI does not run typecheck or build, so run those yourself before
opening a pull request.

## Pull requests

Fill in the [pull request template](.github/pull_request_template.md): a Jira
link, the changes, and any notes. [`CODEOWNERS`](.github/CODEOWNERS) assigns
reviewers.
