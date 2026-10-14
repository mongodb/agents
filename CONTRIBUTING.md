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
| [`apps/`](apps) | Chat clients. [`apps/atlas-explorer-slack-bot`](apps/atlas-explorer-slack-bot) is the Atlas Explorer Slack wrapper around `@repo/agent-engine-chat`. |
| [`packages/`](packages) | Shared libraries and internal CLIs (see below). |
| [`scripts/`](scripts) | Helper scripts, such as a seeder that creates slow queries for Performance Advisor. |
| [`agent.yaml`](agent.yaml) | Registers each agent workspace with Agent Engine. |

Packages under [`packages/`](packages):

- [`@repo/agent-engine-core`](packages/agent-engine-core): shared Agent Engine runtime (LLM builder, tool selection, requester metadata, and LangGraph middleware).
- [`@repo/atlas-explorer-agent`](packages/atlas-explorer-agent): Atlas Explorer prompts, read-only tool allowlist, and HITL write policy, built on `@repo/agent-engine-core`.
- [`@repo/atlas-query-insights-agent`](packages/atlas-query-insights-agent): Atlas Query Insights prompts, read-only tool allowlist, and middleware, built on `@repo/agent-engine-core`.
- [`@repo/agent-engine-chat`](packages/agent-engine-chat): general-purpose [Chat SDK](https://chat-sdk.dev) library that connects any Agent Engine workspace to Slack or other chat platforms.
- [`@repo/agent-engine-load-test`](packages/agent-engine-load-test): CLI for measuring sandbox reuse and Atlas MCP access-token minting.
- [`@repo/update-skills`](packages/update-skills): CLI for refreshing each agent's vendored MongoDB Agent Skills from `mongodb/agent-skills`.

Apps import each library's compiled `dist` folder. The `test`, `build`, and
`typecheck` scripts build the libraries first. If you run `vitest` or `tsc`
directly, build the libraries yourself first.

## Set up

You need:

- Node.js 24 or later. Run `nvm use` to pick it up from [`.nvmrc`](.nvmrc).
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
```

```bash
# HITL: the same read-only Atlas MCP credential, with write tools exposed so
# drop_collection suspends. Approve still fails at Atlas.
# Set ALLOW_WRITE_OPERATIONS=true in .env so the running agent sees it.
# Clear it again afterward, before you deploy.
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

CI does not run the Atlas Explorer or Atlas Query Insights local-stack suites
above. It does run
`pnpm --filter @repo/agent-engine-core test:knowledge`, which calls
`https://knowledge.mongodb.com` through the shared knowledge tools registered
by Atlas Explorer and Atlas Query Insights. That command does not start the
local stack. The dev-up smoke job writes dummy OpenAI and store settings,
clears `mcp.servers` in the runner checkout so startup does not call Atlas,
and checks that `agentengine dev up --headless` brings the Orchestration
Engine up on port 8000.

### Slack bot

The Slack bot has a local integration suite that CI does run. It does not
call Slack or a deployed Agent Engine workspace. The job starts Atlas Explorer
with `agentengine dev up --headless --no-egress`, points the bot's HTTP server
at the local Orchestration Engine, and serves Slack Web API calls from an
in-process stand-in. A local OpenAI stand-in answers model calls.

From `agents/atlas-explorer`, start the Playground, then run the suite from
the repository root:

```bash
agentengine dev up
cd ../..
pnpm test:slack-bot:integration
```

Headless mode leaves port 3000 unused. Use the Orchestration Engine URL
instead:

```bash
AGENTIC_PLAYGROUND_URL=http://127.0.0.1:8000 pnpm test:slack-bot:integration
```

A fast unit test in the same app uses a scripted local invoke endpoint
instead of Agent Engine. `pnpm test:slack-bot` runs that test. The local
OpenAI stand-in used by CI is
`apps/atlas-explorer-slack-bot/scripts/openai-local-mock.mjs`.

## Deploy

Run `agentengine` from the agent directory, or from the repository root with
`--workspace <name>`. This repository is an Agent Engine
[monorepo](https://www.mongodb.com/docs/agentengine/manage/monorepo/). For
MCP configuration and secrets, see each agent's README and the
`deploy-mongodb-agents` skill.

`.agentengine/state.json` is git-ignored, so a new clone or worktree reports
"not initialized". Link it to the existing workspace instead of creating one:

```bash
agentengine context list
agentengine init --context <context> --workspace-id <workspace-id>
```

Without `--context`, `init` fails with "multiple platforms have stored
credentials" if you are signed in to more than one platform. The workspace ID
is in the workspace's dashboard URL. `init` also writes `.env` (from
`.env.example`), `.agents/`, `.claude/`, and `.devcontainer/` in the agent
directory. All are git-ignored. Don't commit them.

Then build and deploy:

```bash
pnpm test:<agent> && pnpm build:<agent>
agentengine agent validate
agentengine build     # about 4 minutes
agentengine deploy    # about 1 minute
agentengine invoke "Hello"
```

- `deploy` refuses to run if `.env` has a populated key that isn't a platform
  secret. On a terminal it offers to store each one as a project-wide secret;
  decline for keys that aren't secrets, and blank them instead.
  `deploy --build-id <id>` skips this check, but also skips the other setup
  checks.
- `agentengine status` can show the previous deployment for a few minutes
  after a deploy succeeds. Use `agentengine deploy list` to confirm.
- Don't pass `--yes` or `--auto` to `deploy`: they accept billed defaults and
  change IP access lists, or build and tail in one step. Don't use `-f` or
  any follow flag in scripts or coding agents, because they never exit.
- On macOS the CLI writes logs under `~/Library/Logs/agentengine`, and it
  needs network access. In a sandboxed shell, run it outside the sandbox.

## Pull requests

- Fill in the [pull request template](.github/pull_request_template.md).
- Keep each pull request focused on one change.
- CI runs unit tests and checks Apache headers on `.ts`, `.tsx`, `.js`,
  `.mjs`, `.cjs`, and `.sh` files. Run `typecheck` and `build` locally before
  you open a pull request.
- Don't edit `.agentengine/`. The `agentengine` CLI generates it.
