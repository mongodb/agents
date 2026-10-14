---
name: atlas-agent-engine
description: Conventions for editing the source of the TypeScript agents in this repo (atlas-explorer, atlas-query-insights): agent.yaml, main.ts, config.ts, the packages/*-agent libraries, tool allowlists, approval middleware, vendored skills, and dev.yaml. Use when changing how an agent is built or what it is allowed to do. Not for running agentengine or Atlas commands, setting secrets, or deploying; use deploy-mongodb-agents.
---

# Working on the Atlas Agent Engine agents

Both agents in `agents/` are TypeScript deep agents built on `@mongodb-js/agent-engine-sdk-langgraph`. Read the agent's own `README.md` first. This skill covers the repo conventions that aren't obvious from the code. For platform questions, use `atlas-agent-engine-docs`. For deploying, use `deploy-mongodb-agents`.

## Layout

```text
agent.yaml                       # root manifest: registers each workspace under agents/
project-config.yaml              # project-level settings (memory), shared by all agents
agents/<name>/
├── agent.yaml                   # this agent's manifest: secrets, egress, MCP, features
├── dev.yaml                     # local-only service ports for `agentengine dev up`
├── src/agent_<name>/
│   ├── main.ts                  # App entrypoint: builds the agent
│   └── config.ts                # non-secret settings: LLM provider/model, prompt persona
└── skills/                      # vendored MongoDB Agent Skills, loaded at runtime
apps/
└── atlas-explorer-slack-bot/    # Atlas Explorer Slack app wrapping @repo/agent-engine-chat
packages/
├── agent-engine-core/           # shared: LLM builder, tool policy, middleware, test client
├── <name>-agent/                # this agent's prompt, tool allowlist, middleware
└── agent-engine-chat/           # reusable Chat SDK library for any Agent Engine workspace
```

- **Behavior belongs in `packages/<name>-agent`**: system prompt, tool allowlists, approval and error middleware. `main.ts` should only assemble them.
- **Shared behavior belongs in `packages/agent-engine-core`.** Don't copy middleware between the two agents.
- **Chat integration belongs in `packages/agent-engine-chat`.** It connects any agent in `agents/` to Slack or other Chat SDK platforms; `apps/atlas-explorer-slack-bot` is the Atlas Explorer Slack wrapper around it.
- `pnpm build` bundles the library into `dist/agent_<name>/main.js` with esbuild, so the platform runs one file plus npm dependencies. It also copies that bundle to `src/agent_<name>/main.bundle.js`, which is git-ignored for the dev container. Don't edit either file.
- Apps import each library's compiled `dist`. Scripts at the repo root and in each agent build the libraries first. If you run `vitest` or `tsc` directly, build them yourself.

## Rules

- Never edit `.agentengine/`. The CLI generates it and can overwrite it.
- Secrets go in `.env` locally (git-ignored) and in `agentengine secret set` for deployed agents. `agent.yaml` lists secret **names** only, never values.
- Agent Engine injects only secret env vars. Provider, model and persona are not secrets, so they live in `config.ts`, not `agent.yaml` or `.env`.
- `dev.yaml` holds local-only settings (ports, local vs remote MongoDB). The build and deploy never read it.
- Apache headers are added to staged `.ts`, `.js` and `.sh` files by the pre-commit hook (`addlicense`). Install it per `CONTRIBUTING.md` or the commit fails.
- Run `agentengine` from the agent directory, or from the repo root with `--workspace <name>`.

## `agent.yaml`

The fields these agents use. Check each against an existing `agents/*/agent.yaml` before adding a new one.

```yaml
name: atlas-explorer
entrypoint: agent_atlas_explorer.main:app   # compiled output: dist/agent_atlas_explorer/main.js
framework: langgraph
language: typescript
features:
    memory: false
    deep_agent: true
required_secrets:
    aer:                         # secrets the agent runtime reads
        - ATLAS_MCP_CLIENT_ID
    tools:                       # secrets each tool sandbox reads
        invoke_llm:              # reserved name: model calls run in the tool sandbox
            - OPENAI_API_KEY
        "mongodb__*":            # MCP tools are prefixed `mongodb__`
            - ATLAS_MCP_CLIENT_ID
network:
    egress:
        - fqdn: api.openai.com
          ports: [443]
          component: tool        # values used here: tool, all
mcp:
    servers:
        mongodb:
            transport: streamable_http
            url: https://mcp.mongodb.com
            auth:
                type: client_credentials
                token_url: https://cloud.mongodb.com/api/oauth/token
                client_id_env: ATLAS_MCP_CLIENT_ID
                client_secret_env: ATLAS_MCP_CLIENT_SECRET
```

- **`entrypoint`** is `<module>:<export>` for the `App` that `main.ts` exports. It names the compiled module, not `src/`.
- **A secret must be declared where it is read.** The model key is needed under both `required_secrets.aer` and `required_secrets.tools.invoke_llm`. The Atlas credentials are needed under `aer` and `tools."mongodb__*"`. A secret set on the platform but not declared isn't available.
- **Outbound traffic is blocked by default.** Every host the agent calls must be in `network.egress`: Atlas and MCP hosts, plus the model provider with `component: tool`.
- **`MONGODB_URI` is injected.** Don't declare it.
- **Memory is off** (`features.memory: false`). The long-term memory settings in `project-config.yaml` don't apply to these agents.
- Changing the model provider means changing `config.ts`, the key under `required_secrets`, and the host under `network.egress` together.
- Validate with `agentengine agent validate` from the agent directory. It checks the manifest only.

## `main.ts`

Both agents follow the same shape:

1. `export const app = new App({ appName })`, then `app.prepareAgentInput(...)`.
2. `export const buildAgent = app.entrypoint(() => { ... })` builds the agent. Inside it:
   - `app.getTools()` returns the tools discovered from the MCP server in `agent.yaml`. Pass them through the agent's tool-selection function so only allowed tools are exposed.
   - `app.checkpointer()` may return `null`; the existing agents handle that. Wrap it with `withRequesterMetadata` and pass it as the agent's checkpointer.
   - `app.deepAgent(llm, { tools, systemPrompt, skills: ["skills"], backend, checkpointer, middleware })` builds the agent. `backend` is `withoutShellExecution(new AgentEngineToolSandboxBackend())`, so the agent has no shell.
3. `app.run()` starts it.

`buildLLM({ provider, model })` is built in `agent-engine-core` and imported through each agent's package, with the values from `config.ts`. Keep the middleware order of the existing agents, and run the package tests if you change it.

## Tools and write policy

- MCP tools aren't declared in code. They come from `agent.yaml`'s `mcp` block and are discovered at startup.
- Each agent has an allowlist of tool names in its package: `READ_ONLY_MCP_TOOLS` in `packages/atlas-explorer-agent/src/agentPolicy.ts` and `ATLAS_QUERY_INSIGHTS_MCP_TOOLS` in `packages/atlas-query-insights-agent/src/toolPolicy.ts`. A new MCP tool is **not** exposed until it's added to the right allowlist, so adding a tool is a security-relevant change.
- **Atlas Query Insights is read-only.** It rejects aggregation pipelines that write (`rejectAggregateWritesMiddleware`). Don't add write tools to it.
- **Atlas Explorer is read-only unless `ALLOW_WRITE_OPERATIONS` is set**, and the MCP credential has a write role. When writes are on, every tool not on the read allowlist pauses for human approval (`humanInTheLoopMiddleware` with `mutativeInterruptOn`). Aggregations containing `$out` or `$merge` also need approval (`approveAggregateWritesMiddleware`). `atlas_create_db_user` and `atlas_create_access_list` are never exposed.
- A read-only MCP credential is the hard limit. The allowlist and approvals reduce risk, but Atlas enforcement is what actually stops a write.

## Human approval

Approval pauses the session at a checkpoint and resumes it after a decision. The decisions are approve, edit and reject (`packages/agent-engine-core/src/aggregateWriteApproval.ts`). `stampResumeClientUserMiddleware` carries the client user onto the resumed run. The Slack bot (`apps/atlas-explorer-slack-bot`) offers Approve and Reject only.

## Skills

`skills/` holds vendored MongoDB Agent Skills, and `skills: ["skills"]` points the agent at that directory. The runtime discovers only immediate child folders that contain a `SKILL.md`, and skips any with a missing or unparsable `name` or `description`.

These are Atlas Explorer-specific forks of `mongodb/agent-skills` (they use the `mongodb__` tool prefix). Pulling upstream drops those adaptations. These are the agent's runtime skills, not the development skills in `.agents/skills/`.

## Local development and tests

```bash
pnpm build                      # from the agent dir; required after source changes
agentengine dev up              # Playground on http://localhost:3000
agentengine dev restart         # after a rebuild; the dev container runs the bundle
agentengine dev stop
```

Both agents use port 3000 (Playground) and 8000 (Orchestration Engine), so run one at a time.

```bash
pnpm test:atlas-explorer        # from the repo root; also test:atlas-query-insights
pnpm --filter <package> typecheck
```

Unit tests mock the LLM and MCP. Prefer them over real model calls. `pnpm test:integration` (from the agent directory) needs `agentengine dev up --headless` and real Atlas MCP and model credentials. See `CONTRIBUTING.md` for the two-phase Explorer write test.

## Before opening a PR

```bash
pnpm test:<agent>
pnpm build:<agent>
agentengine agent validate      # from the agent directory
```

Show any `agent.yaml` change in the PR description, because it changes what the agent can read, reach or write.
