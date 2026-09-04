# Atlas Explorer (Magenta TypeScript)

Atlas Explorer is a MongoDB and Atlas operations agent running on the Magenta
Agentic Platform. It combines Magenta's audited deep-agent runtime with Atlas
Managed MCP tools and the MongoDB Agent Skills bundle.

**Features:** Deep-agent planning · Atlas Managed MCP · MongoDB skills ·
platform checkpoints · runtime approval for persistent mutations

## Layout

```
atlas-explorer/agents/atlas-explorer/
├── agent.yaml                         # app, MCP, features, and required secret names
├── package.json / tsconfig.json       # TypeScript build
├── pnpm-workspace.yaml / pnpm-lock.yaml
├── dev.yaml                           # local Agentic service ports
├── .env.example                       # copy to .env
├── mcp-config.example.json            # copy to ignored local MCP config
├── scripts/                            # temporary Magenta SDK compatibility fixes
├── skills/                            # vendored MongoDB Agent Skills
└── src/agent_atlas_explorer/
    ├── main.ts                        # Magenta deep agent
    ├── agentBackend.ts                # audited filesystem without model shell access
    ├── agentPolicy.ts                 # tool filtering and destructive-tool policy
    ├── modelResponse.ts               # removes repeated OpenAI tool metadata
    ├── toolErrors.ts                  # recoverable MCP error handling
    ├── systemMessage.ts               # Atlas Explorer instructions
    └── llm.ts                         # provider selection
```

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

Create a dedicated MongoDB MCP configuration in Atlas before starting the
agent. Grant only the Atlas roles the agent needs and add the environment's
egress IP to the configuration's access list. The ignored `mcp-config.json`
can hold the values used with the Atlas CLI. Use separate configurations for
local development and production.

For a deployed workspace, store the same values in Magenta's secret store:

```bash
agentic secret set ATLAS_MCP_CLIENT_ID
agentic secret set ATLAS_MCP_CLIENT_SECRET
agentic secret set OPENAI_API_KEY
```

The application selects OpenAI `gpt-5.6-luna` in `main.ts`. To use another
provider, model, or custom-compatible endpoint, update that code together with
the provider-key entries under `required_secrets` and the Tool Pod destination
under `network.egress`. The checked-in manifest permits the default OpenAI
endpoint plus the Atlas OAuth and Managed MCP hosts needed by AER discovery and
Tool Pod calls.

## MCP credential lifecycle

The MCP configuration is provisioned once in Atlas:

1. The operator stores its client ID and secret in `.env` or Magenta's secret
   store.
2. AER and Tool Pod processes exchange those credentials for short-lived OAuth
   access tokens.
3. AER discovers MCP tools from `agent.yaml`; Tool Pods execute subsequent MCP
   calls.

Rotate the client secret in Atlas, update the local or deployed secret, verify
the agent, and then revoke the previous secret. After migrating, remove unused
`atlas-explorer-*` configurations created by the old per-process bootstrap.

## Run locally

```bash
pnpm test
pnpm typecheck
pnpm build
agentic dev up
```

Open the playground at http://localhost:3000. Stop the stack with
`agentic dev stop`.

## What to try

- Ask it to list databases or inspect a collection schema. Read-only MCP tools
  run without approval.
- Ask it to diagnose a query or propose an index. The agent can load the
  relevant MongoDB skill on demand.
- Ask it to drop a collection. The graph suspends before the MCP call and
  resumes only after an approve/edit/reject/respond decision.

## Safety and runtime notes

- Every persistent mutation is protected by LangChain HITL middleware using
  Magenta's persistent checkpointer and suspend/resume adapter. This includes
  database writes; Atlas cluster creation, upgrades, and pause/resume; sample
  dataset loads; project, database-user, and access-list creation; and Atlas
  Streams build, management, and teardown operations.
- `aggregate` remains available for read-only exploration; the agent is
  explicitly forbidden from using `$out` or `$merge` write stages because HITL
  is applied at tool granularity.
- Deep-agent file operations stay on Magenta's audited Tool Pod backend, but
  the model is not given general-purpose shell execution that could read
  process credential files outside the filesystem sandbox.
- MCP validation and query errors are returned to the model so it can correct
  arguments and retry. Graph interrupts are always rethrown.
- OpenAI Responses tool definitions echoed in `response_metadata` are removed
  from prior messages before model calls and from new responses before
  checkpointing, keeping durable sessions compact.
- `atlas-local-*` tools are hidden because they cannot run against Managed MCP.
- The Magenta SDK dependencies are pinned to one tested commit in both
  `package.json` and `pnpm-workspace.yaml`.
- The build-time runner-shared patch resolves bundled skill roots on first
  filesystem access instead of module import, allowing normal static SDK
  imports. Remove it after the pinned Magenta SDK includes the upstream fix.
- Zod is pinned to `4.4.3`; newer `4.5.x` releases currently break Magenta's
  content-block discriminator while messages cross the AER/Tool Pod boundary.
- Do not edit `.agentic/`; it is generated by the Agentic CLI.
