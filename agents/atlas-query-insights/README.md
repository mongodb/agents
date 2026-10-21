# Atlas Query Insights

Atlas Query Insights is a read-only agent that finds slow queries through the
Atlas Performance Advisor tool and explains the highest-impact shapes.
It runs on Atlas Agent Engine with Atlas Managed MCP and five MongoDB
skills.

**Features:** Deep-agent planning · Performance Advisor evidence ·
project and cluster scope · read-only MCP · MongoDB skills

## Layout

```
agents/atlas-query-insights/
├── agent.yaml                         # app, MCP, and required secret names
├── package.json / tsconfig.json       # TypeScript app and esbuild bundle
├── dev.yaml                           # local Agentic service ports
├── .env.example                       # copy to .env
├── mcp-config.example.json            # copy to ignored local MCP config
├── mcp-secret-metadata.json           # secret TTL used with Atlas CLI
├── skills/                            # query optimizer, schema, search, querying, connection
└── src/agent_atlas_query_insights/
    ├── main.ts                        # Agent Engine entrypoint
    └── config.ts                      # LLM, prompt persona, dataAccess, and shape limit
```

Project memory settings live in the repository root
[`project-config.yaml`](../../project-config.yaml). The root
[`agent.yaml`](../../agent.yaml) registers this workspace as
`atlas-query-insights`. Run `agentengine` from this directory, or from the
repository root with `--workspace atlas-query-insights`.

Policy, prompts, and middleware live in
[`@repo/atlas-query-insights-agent`](../../packages/atlas-query-insights-agent).

## Configure

Requires:

- Node.js 24 or newer.
- An Atlas cluster on M10 or larger with recent slow queries. Performance
  Advisor, which the agent reads from, needs both. To create slow queries on
  a test cluster, see [Seed slow queries](#seed-slow-queries).

```bash
cp .env.example .env
cp mcp-config.example.json mcp-config.json
pnpm install
```

Set these local secrets in `.env`:

- `ATLAS_MCP_CLIENT_ID`
- `ATLAS_MCP_CLIENT_SECRET`
- `OPENAI_API_KEY`

Non-secret settings live in `config.ts`: the model, how the agent
introduces itself, optional custom instructions, and an optional
`dataAccess` map of allowed projects and clusters.

Create a **project-level** MongoDB MCP configuration before starting the
agent. Atlas Admin API still calls a project a group, so this uses
`createGroupMcpConfig`. Put the config on the project that holds the
cluster to analyze.

The example config grants `GROUP_DATA_ACCESS_READ_ONLY` only. Do not add
a read-write role.

Copy `mcp-config.example.json` to ignored `mcp-config.json`. Replace
`YOUR_LOCAL_PUBLIC_IP` with this machine's public IPv4. The example already
lists the two
[Agent Engine egress IP addresses](https://www.mongodb.com/docs/agentengine/network-egress/),
which a deployed workspace needs to call the Atlas MCP.

Use a separate MCP configuration per environment, named
`atlas-query-insights-{environment}`. Requires Atlas CLI 1.58 or later.

```bash
atlas auth login -P mcp
export GROUP_ID="<atlas-project-id>"

atlas api remoteMcpConfigurations createGroupMcpConfig \
  --groupId "$GROUP_ID" \
  --file mcp-config.json \
  -P mcp \
  -o json
```

Pass `mcpConfigId` from that response when minting the secret:

```bash
atlas api remoteMcpConfigurations createGroupMcpSecret \
  --groupId "$GROUP_ID" \
  --mcpConfigId "$MCP_CONFIG_ID" \
  --file mcp-secret-metadata.json \
  -P mcp \
  -o json
```

Store `clientId` as `ATLAS_MCP_CLIENT_ID` and the secret as
`ATLAS_MCP_CLIENT_SECRET`. For a deployed workspace:

```bash
agentengine secret set ATLAS_MCP_CLIENT_ID
agentengine secret set ATLAS_MCP_CLIENT_SECRET
agentengine secret set OPENAI_API_KEY
```

The checked-in manifest permits the OpenAI endpoint, the Atlas OAuth and
Managed MCP hosts, and `knowledge.mongodb.com` for the shared knowledge
tools. Changing `llm.provider` also requires the matching key under
`required_secrets` and the provider host under `network.egress`.

OpenAI and Anthropic Claude models are the verified providers.

<details>
<summary><strong>Switch to Anthropic</strong></summary>

1. In `src/agent_atlas_query_insights/config.ts`, set the provider and a
   Claude model:

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

### Set a default cluster

You can configure the Atlas Query Insights Agent to create reports on a default project and cluster. This lets you work with the agent with less back and forth.

If you leave the default config empty, the agent lists your projects
and clusters and asks which one to use first.

1. Set the cluster the agent reports on in
   `src/agent_atlas_query_insights/config.ts`:

   ```ts
   scope: {
     projectId: "<24-character Atlas project ID>",
     clusterName: "<cluster name>",
   },
### Access token limit

The Atlas MCP server allows each service account at most 100 active access
tokens, and each token lasts 1 hour. The MCP configuration's client ID is a
service account, so every run of every workspace that uses the configuration
shares that limit.

Agent Engine mints a new Atlas MCP token, exchanging the client ID and secret
for it, when it starts an AER or Tool Pod process that doesn't already have a
valid one. Each process keeps its own token cache, so a fresh process always
needs a new token.

A session keeps its processes for the idle TTL, which is 600 seconds (10
minutes) by default. Within that window, follow-up messages in the same
session reuse the session's processes and mint nothing. A new run, or a
message sent after the idle TTL has expired, starts new processes. Each cold
start mints 2 tokens: one for the AER process and one for the Tool
Pod.

Expected capacity: about 40 to 50 new or resumed sessions per hour for each
MCP configuration, shared by every run that uses it. Agent Engine can also
start spare processes ahead of demand, and those can mint tokens while the
agent is idle.

When the limit is reached:

- New runs fail with `The agent did not become ready during startup.`
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
- Cap how many runs clients can start. The
  [Atlas Explorer Slack bot's session limit](../../apps/atlas-explorer-slack-bot#session-limit)
  shows one way: it refuses new conversations with a clear message before the
  tokens run out.
- Spread scheduled reports and evaluation runs over time. Each new run, and
  each message sent after the idle TTL, costs 2 tokens, so a burst
  of runs uses the limit quickly. Send follow-ups in the same session within
  10 minutes to reuse its processes.
- To handle more traffic, deploy several copies of the agent, each in its
  own workspace with its own MCP configuration, and balance new runs
  across them. Each MCP configuration has its own token limit. Keep every
  run on the copy that started it, because session state belongs to one
  workspace.

## Seed slow queries

Performance Advisor needs recent slow query logs before it can suggest
indexes. From the repository root, point the seeder at a disposable
cluster. The script drops and recreates the `highImpact` database.

```bash
./scripts/seed-pa-slow-queries/seed.sh "mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/"
```

Copy `scripts/seed-pa-slow-queries/.env.example` to `.env` in that
directory and set `MONGODB_URI` to run `./seed.sh` with no arguments.
Requires `mongosh` on `PATH`. Wait a few minutes so the cluster's
Performance Advisor can see the new slow logs.

## Run locally

The playground port is 3000, the same port Atlas Explorer uses. Stop the
other workspace before starting this one.

```bash
pnpm test
pnpm typecheck
pnpm build
agentengine dev up
```

The dev container can't see the monorepo packages, so it runs the bundle
from `pnpm build` instead of rebuilding. After source changes, run
`pnpm build`, then `agentengine dev restart`.

Open the playground at http://localhost:3000. Stop the stack with
`agentengine dev stop`.

## Get a report

Ask a question about slow queries. There's no separate command. The examples
assume you set a [default cluster](#set-a-default-cluster).

- "Which slow queries matter most?"
- "Which slow queries matter most since Monday?"
- "Look at slow queries on the `orders` collection."

To ask about a cluster other than the default, name it in the question.

Where to ask:

- **Playground (local):** http://localhost:3000 after `agentengine dev up`.
- **Deployed agent:** from this directory, run
  `agentengine invoke "Which slow queries matter most?"`.
- **Slack:** DM the bot or mention it in a channel. See
  [Talk from chat platforms](#talk-from-chat-platforms).
- **On a schedule:** post the question with Slack Workflow Builder. See
  [Authorize scheduled Workflow Builder messages](../../apps/atlas-explorer-slack-bot/README.md#authorize-scheduled-workflow-builder-messages).

## Talk from chat platforms

[`@repo/agent-engine-chat`](../../packages/agent-engine-chat) connects any
Agent Engine workspace, including `atlas-query-insights`, to Slack or other
[Chat SDK](https://chat-sdk.dev) platforms.
[`apps/atlas-explorer-slack-bot`](../../apps/atlas-explorer-slack-bot) is a
reference Slack bot app built on it.

## How the report works

1. The agent calls the Performance Advisor tool for one cluster to get slow
   query logs and suggested indexes. By default, Atlas returns the last 24
   hours. You can ask the agent to start from a different date or to look at
   specific collections.
2. The tool returns up to 50 recent slow query logs from each node in the
   cluster, so a three-node replica set can return up to 150. This is a
   sample, not every execution of a query over time.
3. The agent groups the logs into query shapes, with literal values
   replaced by placeholders. It orders them by documents examined, then
   working time, then execution count.
4. It reports on the top three shapes. To change that, set `maxQueryShapes`
   in `config.ts`. Each shape gets a plain-language overview and up to two
   areas worth investigating, usually with a link to the MongoDB docs. When
   Performance Advisor suggests an index for a shape, that suggestion comes
   first, with the full index definition and the `createIndex` command that
   would create it. The agent doesn't run the command. You decide whether
   to.

Things to know:

- The agent only names index fields that Performance Advisor suggested.
- The model sees the raw Performance Advisor output as well as the redacted
  query shapes. The raw slow query log lines can include literal query
  values; those values are sent to your model provider and appear in Agent
  Engine traces. You govern that data. See
  [Your data](../../README.md#your-data).
- `dataAccess` in `config.ts` limits the agent to the listed projects and
  clusters. Leave it as `{}` for no restriction: every project and cluster
  the MCP configuration can reach. Otherwise map each 24-hex project id to
  `{}` (all its clusters) or
  `{ clusterNames: [...] }`. The system prompt names the allowed projects
  and clusters, and `clusterAllowlistMiddleware` rejects tool calls that
  name any other project or cluster. This is a guardrail in the agent. The
  hard boundary is the one Atlas project that the MCP configuration belongs to.

## Safety

- The MCP configuration uses `GROUP_DATA_ACCESS_READ_ONLY`.
- The tool allowlist never enables writes, and there is no
  human-in-the-loop path.
- `aggregate` stays available for read pipelines. A pipeline that contains
  `$out` or `$merge` is rejected because this agent is read-only.
- Access belongs to the MCP configuration, not to each user. Everyone who can
  run this agent sees the same data. Grant it only to people who may see that
  data.
- You can restrict the tool set. To limit which Atlas MCP tools the agent can
  use, list them under `mcp.servers.mongodb.allowed_tools` in `agent.yaml`.
  See
  [Use Remote MCP Servers](https://www.mongodb.com/docs/agentengine/add-features/remote-mcp/).
- Slow query logs and Performance Advisor output can contain prompt-injection
  text aimed at the model. The agent can't write, but injected text can still
  skew its report, so review its recommendations before you act on them.
- The agent redacts pasted credentials from each user message before the model
  sees it, and refuses messages that are too long to screen. `inputGuard` in
  `config.ts` sets `mode` (`enforce`, `monitor` or `off`). The guard doesn't
  screen the slow query logs or Performance Advisor output above. See
  [Input guard](../../packages/agent-engine-core/src/inputGuard.ts).

### Roll back or shut down

You own your deployment, so MongoDB can't roll it back for you. If you find a
defect or a security problem:

1. **Stop callers.** Pause any scheduled workflow or job that invokes the
   agent.
2. **Revoke credentials.** Delete the MCP client secret in Atlas.
3. **Reissue and redeploy.** Create a new MCP client secret and update the
   Agent Engine secrets. Then redeploy a known-good build with
   `agentengine deploy --build-id <id>`, or build and deploy a fixed version
   from `mongodb/agents`.
4. **Check and restart.** Confirm the agent works with `agentengine invoke`,
   then turn callers back on.
