# Atlas Explorer (Agent Engine TypeScript)

Atlas Explorer is a MongoDB and Atlas operations agent running on Agent
Engine. It combines Agent Engine's audited deep-agent runtime with Atlas
Managed MCP tools and the MongoDB Agent Skills bundle.

**Features:** Deep-agent planning · Atlas Managed MCP · MongoDB skills ·
platform checkpoints · read-only by default · runtime approval for writes

## Layout

```
agents/atlas-explorer/
├── agent.yaml                         # app, MCP, features, and required secret names
├── package.json / tsconfig*.json      # TypeScript app, test config, and esbuild bundle
├── vitest*.config.ts                  # unit and integration test configs
├── dev.yaml                           # local Agentic service ports
├── .env.example                       # copy to .env
├── mcp-config.example.json            # copy to ignored local MCP config
├── mcp-secret-metadata.json           # secret TTL used with Atlas CLI
├── skills/                            # vendored MongoDB Agent Skills
└── src/agent_atlas_explorer/
    ├── main.ts                        # Agent Engine App entrypoint
    ├── index.ts                       # re-exports library helpers and main.ts
    └── config.ts                      # non-secret LLM, agent name, and custom instructions
```

Project memory settings live in the repository root
[`project-config.yaml`](../../project-config.yaml). The root
[`agent.yaml`](../../agent.yaml) registers this workspace as
`atlas-explorer`. Run `agentengine` commands from this directory, or from
the repository root with `--workspace atlas-explorer`. The root
[`.agentengineignore`](../../.agentengineignore) lists what `agentengine build`
leaves out of the uploaded source.

Policy, prompts, LLM selection, and middleware live in
[`@repo/atlas-explorer-agent`](../../packages/atlas-explorer-agent).
`pnpm build` bundles that library into `dist/agent_atlas_explorer/main.js`
so Agent Engine runs one file plus this app's npm dependencies. The `build`,
`test`, `typecheck`, and `dev` scripts first build that library (and
`@repo/agent-engine-core` under it) through `pre*` hooks. See the
[package README](../../packages/atlas-explorer-agent/README.md) for its exports.

## Configure

Requires Node.js 24 or newer.

```bash
cp .env.example .env
cp mcp-config.example.json mcp-config.json
pnpm install
```

Set these local secrets in `.env`:

- `ATLAS_MCP_CLIENT_ID`
- `ATLAS_MCP_CLIENT_SECRET`
- `OPENAI_API_KEY`

Leave `ALLOW_WRITE_OPERATIONS` unset, empty, or `"false"` unless this
environment should expose write tools. Any other non-empty value enables
writes.

Create a **project-level** MongoDB MCP configuration in Atlas before starting
the agent. Atlas Admin API still calls a project a group, so this uses
`createGroupMcpConfig` rather than the org-level API. A group config can only
see clusters in that one Atlas project; put it on the project that holds the
data the agent should explore. Project roles such as
`GROUP_DATA_ACCESS_READ_ONLY` are invalid on `createOrgMcpConfig`.

Assign Atlas roles on the MCP configuration itself. `createGroupMcpConfig`
creates that identity; `createGroupMcpSecret` only mints a client secret that
inherits the configuration's roles and read-only setting. The example config
grants `GROUP_DATA_ACCESS_READ_ONLY`, which also inherits Project Read Only
control-plane privileges. Keep Atlas MCP read-only mode enabled unless this
environment is intentionally write-capable.

Copy `mcp-config.example.json` to ignored `mcp-config.json`. Replace
`YOUR_LOCAL_PUBLIC_IP` with this machine's public IPv4 (`curl -4 ifconfig.me`).
Replace the `AGENT_ENGINE_IP_*` placeholders with your Agent Engine deployment's
egress addresses so a deployed workspace can call Managed MCP.

Create a **separate MCP configuration and token per environment** (local
development, staging, production, and so on). Do not share credentials across
environments. Set `mcpConfigName` using the `atlas-explorer-{environment}`
pattern from `mcp-config.example.json` (for example,
`atlas-explorer-local` or `atlas-explorer-prod`), then run
`createGroupMcpConfig` and `createGroupMcpSecret` for each environment and
store the resulting client ID and secret only in that environment's `.env` or
Agent Engine secret store.

Requires Atlas CLI 1.58 or later. Log in, then create the config against the
target project (`groupId` is the Atlas project ID):

```bash
atlas auth login -P mcp
export GROUP_ID="<atlas-project-id>"

atlas api remoteMcpConfigurations createGroupMcpConfig \
  --groupId "$GROUP_ID" \
  --file mcp-config.json \
  -P mcp \
  -o json
```

The response includes `mcpConfigId` (UUID of the MCP configuration) and
`clientId` (the `mdb_sa_id_...` OAuth client). Pass **`mcpConfigId`**, not
`clientId`, when minting the one-time secret:

```bash
atlas api remoteMcpConfigurations createGroupMcpSecret \
  --groupId "$GROUP_ID" \
  --mcpConfigId "$MCP_CONFIG_ID" \
  --file mcp-secret-metadata.json \
  -P mcp \
  -o json
```

The secret is returned once. Store `clientId` as `ATLAS_MCP_CLIENT_ID` and the
secret as `ATLAS_MCP_CLIENT_SECRET`. After swapping credentials, restart
`agentengine dev` and start a new Playground thread so the runtime does not reuse a
cached token or an old cluster connection.

For a deployed workspace, store the same values in Agent Engine's secret store:

```bash
agentengine secret set ATLAS_MCP_CLIENT_ID
agentengine secret set ATLAS_MCP_CLIENT_SECRET
agentengine secret set OPENAI_API_KEY
```

Writes require two independent opt-ins. Either remaining read-only is enough
to prevent ordinary write-tool use:

1. Provision a write-capable MCP configuration with only the Atlas roles the
   environment needs, such as `GROUP_DATA_ACCESS_READ_WRITE`.
2. Set `ALLOW_WRITE_OPERATIONS` to a non-empty value other than `"false"`
   locally or with `agentengine secret set ALLOW_WRITE_OPERATIONS`.

The application selects OpenAI `gpt-6-luna` in `config.ts`. To use another
provider, model, or custom-compatible endpoint, update that file together with
the provider-key entries under `required_secrets` and the Tool Pod destination
under `network.egress`. The checked-in manifest permits the default OpenAI
endpoint plus the Atlas OAuth and Managed MCP hosts needed by AER discovery and
Tool Pod calls.

`config.ts` also owns the system-prompt persona. Set
`systemPrompt.name` to change how the agent introduces itself; leave it empty
to keep **Atlas Explorer**. Set `systemPrompt.customInstructions` to append
operator-specific guidance after the built-in operating rules. Leave that
field empty to skip extra prompt text. Built-in safety rules still apply.

## MCP credential lifecycle

The MCP configuration is provisioned once in Atlas, scoped to one project:

1. The operator creates a group MCP config with `createGroupMcpConfig`,
   assigning least-privilege roles there. `createGroupMcpSecret` then mints a
   secret that inherits those roles. Store the client ID and secret in `.env`
   or Agent Engine's secret store.
2. AER and Tool Pod processes exchange those credentials for short-lived OAuth
   access tokens.
3. AER discovers MCP tools from `agent.yaml`; Tool Pods execute subsequent MCP
   calls.

Rotate the client secret in Atlas, update the local or deployed secret, verify
the agent, and then revoke the previous secret.

## Run locally

```bash
pnpm test
pnpm test:integration
pnpm typecheck
pnpm build
agentengine dev up
```

The dev container and the platform image install with npm and cannot see a
pnpm workspace install. `pnpm build` writes a bundle the npm build copies
into `dist`. After source changes, run `pnpm build`, then
`agentengine dev restart`.

Open the playground at http://localhost:3000. Stop the stack with
`agentengine dev stop`.

## Talk from chat platforms

The sibling [`@AtlasExplorer` Chat SDK integration](../../apps/atlas-explorer-slack-bot) invokes
this same Agent Engine workspace and preserves Agentic sessions per platform thread.
Its current Slack adapter supports local Socket Mode, Vercel deployment, and
Approve/Reject controls for this agent's mutation interrupts; shared handlers
can be reused with additional Chat SDK adapters.

## What to try

- Ask it to list databases or inspect a collection schema. Read-only MCP tools
  run without approval.
- Ask it to diagnose a query or propose an index. The agent can load the
  relevant MongoDB skill on demand.
- Ask it to drop a collection. With the default read-only MCP identity and
  unset `ALLOW_WRITE_OPERATIONS`, the agent cannot execute that mutation. After
  both write opt-ins are set, the graph suspends before the MCP call and
  resumes only after an approve/edit/reject/respond decision.

## Safety and runtime notes

- Atlas Explorer is read-only by default. The MCP configuration should use
  `GROUP_DATA_ACCESS_READ_ONLY`, and `ALLOW_WRITE_OPERATIONS` should stay
  unset or `"false"`. The application also hides non-read MongoDB MCP tools
  unless that secret is enabled; remaining tools then require HITL
  approval. This application allowlist is a bridge until Agent Engine preserves
  MCP tool annotations.
- When both write opt-ins are present, persistent mutations are protected by
  LangChain HITL middleware using Agent Engine's persistent checkpointer and
  suspend/resume adapter. This includes database writes; Atlas cluster
  creation, upgrades, and pause/resume; sample dataset loads; project,
  database-user, and access-list creation; and Atlas Streams build,
  management, and teardown operations.
- `aggregate` remains available for read-only exploration; the agent is
  explicitly forbidden from using `$out` or `$merge` write stages because HITL
  is applied at tool granularity. A read-only Atlas credential is the hard
  boundary for those argument-dependent writes.
- Deep-agent file operations stay on Agent Engine's audited Tool Pod backend, but
  the model is not given general-purpose shell execution that could read
  process credential files outside the filesystem sandbox.
- MCP validation and query errors are returned to the model so it can correct
  arguments and retry. Graph interrupts are always rethrown.
- OpenAI Responses tool definitions echoed in `response_metadata` are removed
  from prior messages before model calls and from new responses before
  checkpointing, keeping durable sessions compact.
