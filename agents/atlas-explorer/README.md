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
inherits the configuration's roles. The configuration has no separate
read-only switch: its roles alone decide what the agent can do in Atlas. The
example config grants `GROUP_DATA_ACCESS_READ_ONLY`, which also inherits
Project Read Only control-plane privileges. Keep the roles read-only unless
this environment is intentionally write-capable.

Copy `mcp-config.example.json` to ignored `mcp-config.json`. Replace
`YOUR_LOCAL_PUBLIC_IP` with this machine's public IPv4 (`curl -4 ifconfig.me`).
The example already lists the two
[Agent Engine egress IP addresses](https://www.mongodb.com/docs/agentengine/network-egress/),
which a deployed workspace needs to call the Atlas MCP.

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

## How writes work

Atlas Explorer is read-only by default. The example MCP configuration grants
read-only roles, and the agent hides every MCP tool that isn't on its
read-only allowlist (`READ_ONLY_MCP_TOOLS` in
[`agentPolicy.ts`](../../packages/atlas-explorer-agent/src/agentPolicy.ts);
a bridge until Agent Engine preserves MCP tool annotations).

Writes require two independent opt-ins. Either one remaining read-only is
enough to prevent ordinary write-tool use:

1. Provision a write-capable MCP configuration with only the Atlas roles the
   environment needs, such as `GROUP_DATA_ACCESS_READ_WRITE`. A read-only
   credential is the hard limit: Atlas rejects writes made with it.
2. Set `ALLOW_WRITE_OPERATIONS` to a non-empty value other than `"false"`.
   Locally, set it in `.env`. For a deployed workspace, add
   `ALLOW_WRITE_OPERATIONS` under `required_secrets.aer` in `agent.yaml`,
   then run `agentengine secret set ALLOW_WRITE_OPERATIONS`. The checked-in
   manifest doesn't declare it, so a deployed agent stays read-only until you
   add it.

When writes are enabled, every MCP tool that isn't on the read-only allowlist
is exposed, and each one pauses for approval before it runs (through LangChain
HITL middleware and Agent Engine's persistent checkpointer). That includes
tools the allowlist doesn't recognize, such as tools added to Atlas MCP
later. These tools are not included in either mode:

- `mongodb__atlas_create_db_user`
- `mongodb__atlas_create_access_list`

You can approve, edit, or reject each remaining call. The
[Slack bot](../../apps/atlas-explorer-slack-bot) offers only Approve and
Reject.

`aggregate` and `aggregate_db` stay on the read allowlist, so a normal
pipeline runs without approval. A pipeline that contains `$out` or `$merge`
writes data. These require HITL approval.

## Model and persona

The application selects OpenAI `gpt-6-luna` in `config.ts`. OpenAI and
Anthropic Claude models are the verified providers. To use another provider,
model, or custom-compatible endpoint, update that file together with the
provider-key entries under `required_secrets` and the Tool Pod destination
under `network.egress`. The checked-in manifest permits the default OpenAI
endpoint, the Atlas OAuth and Managed MCP hosts needed by AER discovery and
Tool Pod calls, and `knowledge.mongodb.com` for the wrapped knowledge-base tools.

<details>
<summary><strong>Switch to Anthropic</strong></summary>

1. In `src/agent_atlas_explorer/config.ts`, set the provider and a Claude
   model:

   ```ts
   llm: {
     provider: "anthropic",
     model: "claude-haiku-5-5",
   },
   ```

2. In `agent.yaml`, replace `OPENAI_API_KEY` with `ANTHROPIC_API_KEY` under
   both `required_secrets.aer` and `required_secrets.tools.invoke_llm`. Then
   replace the `api.openai.com` egress rule with the Anthropic API host:

   ```yaml
   - fqdn: api.anthropic.com
     ports: [443]
     component: tool
   ```

3. Set `ANTHROPIC_API_KEY` in `.env`. For a deployed workspace, also store it
   as a platform secret and stop requiring the OpenAI key:

   ```bash
   agentengine secret set ANTHROPIC_API_KEY
   ```

To send requests through an Anthropic-compatible gateway, allow that host in
`network.egress` instead of `api.anthropic.com`, set `ANTHROPIC_BASE_URL` in
`.env`, and for a deployed workspace add `ANTHROPIC_BASE_URL` to
`required_secrets.aer` and `required_secrets.tools.invoke_llm` and store it
with `agentengine secret set ANTHROPIC_BASE_URL`.

</details>

`config.ts` also owns the system-prompt persona. Set
`systemPrompt.name` to change how the agent introduces itself; leave it empty
to keep **Atlas Explorer**. Set `systemPrompt.customInstructions` to append
operator-specific guidance after the built-in operating rules. Leave that
field empty to skip extra prompt text. Built-in safety rules still apply.

## Limit projects and clusters

Set `dataAccess` in `config.ts` to limit the agent to specific Atlas projects
and clusters:

```ts
dataAccess: {
  // Only these clusters in this project.
  "64a1f3c2e8b94d0012c7a5e1": { clusterNames: ["example-test"] },
  // Every cluster in this project.
  "65c3d9e07f21ab4408d6e3f2": {},
},
```

- `clusterNames: ["a", "b"]` allows only those clusters in the project.
- `{}` for a project allows every cluster in it.
- `clusterNames: []` allows the project but none of its clusters.
- `dataAccess: {}` limits nothing. The agent can use every project and
  cluster the MCP configuration can reach.

### What the agent enforces

- The system prompt lists the allowed projects and clusters in a `## Scope`
  section.
- `clusterAllowlistMiddleware` rejects any tool call that names a project or
  cluster outside `dataAccess`.
- The prompt also warns that project and cluster lists in tool results can
  include entries outside `dataAccess`. Using one returns an error.
- With writes enabled, creating, pausing, or upgrading a cluster must name an
  allowed cluster. Creating a project is rejected.

### What it cannot enforce

The check runs in the agent and only reads the arguments of each tool call.
Atlas still limits the agent to the project and roles of its MCP
configuration. `dataAccess` can narrow that access but never widen it.

**Existing Atlas Stream Processing connections.** This applies only when
writes are enabled. A connection is a saved link from a stream workspace to a
data source, such as a cluster.

- When the agent creates a connection to a cluster, it must name an allowed
  cluster, so the check works.
- When the agent updates or uses a connection that already exists, the call
  names the connection, not its cluster. The check cannot tell where it
  points.
- If an existing connection points at a cluster outside `dataAccess`, the
  agent can still change it, or start a processor that reads or writes
  through it.

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

### Access token limit

The Atlas MCP server allows each service account at most 100 active access
tokens, and each token lasts 1 hour. The MCP configuration's client ID is a
service account, so everything that uses the configuration shares that limit:
the Playground, the CLI, the Slack bot, and any evaluation runs.

Agent Engine mints a new Atlas MCP token when it starts an AER or Tool Pod
process that doesn't already have a valid one (step 2 above). Each process
keeps its own token cache, so a fresh process always needs a new token.

A session keeps its processes for the idle TTL, which is 600 seconds (10
minutes) by default. Within that window, follow-up messages and approval
resumes reuse the session's processes and mint nothing. A new conversation,
or a message sent after the idle TTL has expired, starts new processes. Each
cold start mints 2 tokens: one for the AER process and one for the
Tool Pod.

Expected capacity:

- About 40 to 50 new or resumed sessions per hour for each MCP configuration,
  shared by every user of that configuration: the Playground, the CLI, the
  Slack bot, and evaluation runs.
- Agent Engine can start spare processes ahead of demand. Those can mint tokens
  while no conversation is using them, so an idle agent still uses part of the
  limit.

When the limit is reached:

- New conversations fail with `The agent did not become ready during
  startup.`
- Runtime logs show `Access Token limit reached`:

  ```bash
  agentengine logs --grep "Access Token limit" --since 1h
  ```

- The workspace recovers on its own as the oldest tokens expire, within an
  hour of the burst. Redeploying doesn't help, because the redeployed
  processes need new tokens too.
- The process that failed to start throws `McpTokenLimitError`. It names the
  runtime (`agent` or `tool`) and the limit that refused the token: the
  service account's token limit, or the token endpoint's rate limit of 50
  requests per minute per service account and IP address.
- Tool calls reuse the token their process minted at startup, so a running
  session isn't affected until that token expires an hour later.

To stay under the limit:

- Use a separate MCP configuration for each environment, as described in
  [Configure](#configure).
- Cap how many sessions clients can start. The
  [Slack bot's session limit](../../apps/atlas-explorer-slack-bot#session-limit)
  refuses new conversations with a clear message before the tokens run out.
- Spread load tests and evaluation runs over time. Each new conversation, and
  each message sent after the idle TTL, costs 2 tokens, so a burst of new
  conversations uses the limit quickly. Send follow-ups in the same session
  within 10 minutes to reuse its processes.
- To handle more traffic, deploy several copies of the agent, each in its
  own workspace with its own MCP configuration, and balance new
  conversations across them. Each MCP configuration has its own token
  limit. Keep every conversation on the copy that started it, because
  session state belongs to one workspace.

## Run locally

```bash
pnpm test
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
Approve/Reject controls for this agent's mutation interrupts; the shared handlers in
[`@repo/agent-engine-chat`](../../packages/agent-engine-chat) can be reused with
additional Chat SDK adapters or other Agent Engine workspaces.

## What to try

- Ask it to list databases or inspect a collection schema. Read-only MCP tools
  run without approval.
- Ask it to look up MongoDB docs or best practices. `search_knowledge` and
  `list_knowledge_sources` come from `@repo/agent-engine-core`, wrap
  `@mongodb-js/mcp-tools-assistant`, and call the public knowledge API
  without MCP credentials.
- Ask it to drop a collection. With the default read-only MCP identity and
  unset `ALLOW_WRITE_OPERATIONS`, the agent cannot execute that mutation. After
  both write opt-ins are set, the graph suspends before the MCP call and
  resumes only after an approve, edit, or reject decision.

## Safety and runtime notes

### Security model

- **Read-only by default, with approval for writes.** Writes stay off unless
  both opt-ins are set, and every write pauses for human approval. See
  [How writes work](#how-writes-work).
- **The MCP configuration decides access, not the user.** Atlas checks the
  configuration's roles. It doesn't check who is chatting with the agent.
  Everyone who can reach the agent has the same Atlas access. Grant only roles
  that all of them should have, and be cautious about giving any agent access
  to sensitive data.
- **You can restrict the tool set.** To limit which Atlas MCP tools the agent
  can use, list them under `mcp.servers.mongodb.allowed_tools` in
  `agent.yaml`. See
  [Use Remote MCP Servers](https://www.mongodb.com/docs/agentengine/add-features/remote-mcp/).
- **No general-purpose shell access.** Deep-agent file operations run on Agent
  Engine's audited Tool Pod backend without shell execution that could read
  process credential files outside the filesystem sandbox.
- **Prompt injection.** Data and chat messages can contain
  instructions aimed at the model, and no defense fully prevents that. Impact
  is bounded by the controls above and the egress policy in `agent.yaml`,
  which blocks outbound traffic to unlisted hosts so injected text can't send
  data elsewhere.
- **Input guard.** The agent redacts pasted credentials from each user message
  before the model sees it, and refuses messages that are too long to screen.
  `inputGuard.mode` in `config.ts` is `enforce`, `monitor` or `off`. The guard
  doesn't screen tool output. See
  [Input guard](../../packages/agent-engine-core/src/inputGuard.ts).
- **Your data is in traces.** Conversations and traces in Agent Engine can
  include database names, collection names, and sampled documents. They are
  visible only inside your project, and you govern them. Your model provider
  also receives the prompts and tool results.

See [Built-in guardrails](../../README.md#built-in-guardrails) for the repo-wide view.

### Roll back or shut down

You own your deployment, so MongoDB can't roll it back for you. If you find a
defect or a security problem:

1. **Stop callers.** Stop the
   [Slack bot](../../apps/atlas-explorer-slack-bot/README.md#shut-down-the-bot)
   and pause any scheduled workflow or job that invokes the agent.
2. **Revoke credentials.** Delete the MCP client secret in Atlas.
3. **Reissue and redeploy.** Create a new MCP client secret and update the
   Agent Engine secrets. Then redeploy a known-good build with
   `agentengine deploy --build-id <id>`, or build and deploy a fixed version
   from `mongodb/agents`.
4. **Check and restart.** Confirm the agent works with `agentengine invoke`,
   then turn callers back on.

### Runtime notes

- MCP validation and query errors are returned to the model so it can correct
  arguments and retry. Graph interrupts are always rethrown.
- OpenAI Responses tool definitions echoed in `response_metadata` are removed
  from prior messages before model calls and from new responses before
  checkpointing, keeping durable sessions compact.
