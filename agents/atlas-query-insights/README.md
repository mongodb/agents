# Atlas Query Insights

Atlas Query Insights is a read-only agent that finds slow queries through the
Atlas Performance Advisor tool and explains the highest-impact shapes.
It runs on the Agentic Platform with Atlas Managed MCP and five MongoDB
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
    └── config.ts                      # LLM, prompt persona, scope, and shape limit
```

Project memory settings live in the repository root
[`project-config.yaml`](../../project-config.yaml). The root
[`agent.yaml`](../../agent.yaml) registers this workspace as
`atlas-query-insights`. Run `agentengine` from this directory, or from the
repository root with `--workspace atlas-query-insights`.

Policy, prompts, and middleware live in
[`@repo/atlas-query-insights-agent`](../../packages/atlas-query-insights-agent).

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

Non-secret settings live in `config.ts`: the model, how the agent
introduces itself, optional custom instructions, and an optional project
and cluster.

Create a **project-level** MongoDB MCP configuration before starting the
agent. Atlas Admin API still calls a project a group, so this uses
`createGroupMcpConfig`. Put the config on the project that holds the
cluster to analyze.

The example config grants `GROUP_DATA_ACCESS_READ_ONLY` only. Do not add
a read-write role.

Copy `mcp-config.example.json` to ignored `mcp-config.json`. Replace
`YOUR_LOCAL_PUBLIC_IP` with this machine's public IPv4. Keep the Agentic
Platform egress addresses so a deployed workspace can call Managed MCP.

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

The checked-in manifest permits the OpenAI endpoint plus the Atlas OAuth
and Managed MCP hosts. Changing `llm.provider` also requires the matching
key under `required_secrets` and the provider host under `network.egress`.

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

Ask which slow queries matter on the cluster. The agent should explain
the highest-impact shapes.

## Safety

- The MCP configuration uses `GROUP_DATA_ACCESS_READ_ONLY`.
- The tool allowlist never enables writes, and there is no
  human-in-the-loop path.
- The MCP configuration belongs to one project, so the agent cannot reach
  another.
- The agent can recommend an index. It cannot create one.
