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
- Go, for [`addlicense`](https://github.com/google/addlicense). The pre-commit
  hook uses it to add the Apache header to source files.

Then install and run the tests:

```bash
corepack enable
pnpm install
go install github.com/google/addlicense@v1.2.0
pnpm test:atlas-explorer
```

`pnpm install` runs Husky and points Git at [`.husky/`](.husky). On commit,
that hook runs `addlicense` on staged `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`,
and `.sh` files and stages the header it adds. Put `$(go env GOPATH)/bin` on
your `PATH` so the hook can find `addlicense`. Cloud Agent machines install
the binary from [`.cursor/install.sh`](.cursor/install.sh).

Each agent has `pnpm test:<agent>` and `pnpm build:<agent>` scripts at the
repository root, such as `pnpm test:atlas-query-insights`. Each package also has its
own `test` and `typecheck` scripts. Run them with
`pnpm --filter <package> <script>`.

To run an agent locally, run `agentengine dev up` from its directory, or from
the repository root with `--workspace <name>`. For configuration, see the
agent's README.

## Full-stack integration tests

Atlas Explorer and Atlas Query Insights each have an opt-in suite,
`pnpm test:integration`, run from the agent directory. The tests call the
local Orchestration Engine on port 8000 and check execution status, MCP tool
calls recorded in checkpoints, and requester metadata. They do not grade the
model's wording. The client is `@repo/agent-engine-core/testing`.

Run them against `agentengine dev up --headless` with real Atlas MCP and
OpenAI credentials. When `CI` is unset, the suite also pings OpenAI and
Anthropic. The two agents share ports 3000 and 8000, so stop one before
starting the other.

### Atlas Explorer

From `agents/atlas-explorer`. The read-only suite skips when
`ALLOW_WRITE_OPERATIONS` is set. The HITL suite skips when it is unset, so
run the two phases separately.

```bash
# Read-only: boot, list_databases, session continuity, hidden writes,
# requester metadata. Leave ALLOW_WRITE_OPERATIONS unset or empty in .env.
agentengine dev up --headless
pnpm test:integration
agentengine dev stop

# HITL: the same read-only Atlas MCP credential, with write tools exposed so
# drop_collection suspends. Approve still fails at Atlas.
# Set ALLOW_WRITE_OPERATIONS=true in .env so the running agent sees it.
agentengine dev up --headless
ALLOW_WRITE_OPERATIONS=true pnpm test:integration
agentengine dev stop
```

### Atlas Query Insights

From `agents/atlas-query-insights`. This agent has no write-tools switch and
no HITL path. Use a project MCP configuration with
`GROUP_DATA_ACCESS_READ_ONLY`.

```bash
agentengine dev up --headless
pnpm test:integration
agentengine dev stop
```

The suite covers a trivial invoke, `list_databases`, session continuity, a
drop request that must not call a write tool, and requester metadata.

### GitHub Actions

CI does not run these suites. The dev-up smoke job writes dummy OpenAI and
store settings, clears `mcp.servers` in the runner checkout so startup does
not call Atlas, and checks that `agentengine dev up --headless` brings the
Orchestration Engine up on port 8000.

## Pull requests

- Fill in the [pull request template](.github/pull_request_template.md).
- Keep each pull request focused on one change.
- CI runs unit tests and checks Apache headers on `.ts`, `.tsx`, `.js`,
  `.mjs`, `.cjs`, and `.sh` files. Run `typecheck` and `build` locally before
  you open a pull request.
- Don't edit `.agentengine/`. The `agentengine` CLI generates it.
