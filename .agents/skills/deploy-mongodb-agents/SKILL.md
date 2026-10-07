---
name: deploy-mongodb-agents
description: Deploy Atlas Explorer or Atlas Query Insights to Atlas Agent Engine with the agentengine CLI. Use when asked to deploy, redeploy, ship, or set up credentials for an agent in this repo, including creating the Atlas MCP configuration, setting platform secrets, enabling writes, or changing the model provider. Also use when a deploy failed, is stuck, or succeeded but the agent doesn't work.
---

# Deploy an Atlas agent to Agent Engine

Deploys one agent from `agents/<name>` (`atlas-explorer` or `atlas-query-insights`) to your own Agent Engine project. Both agents follow the same steps. Each agent's README is the source of truth for details; if it disagrees with this skill, follow the README.

Run `agentengine` commands from the agent directory, or from the repo root with `--workspace <name>`.

## Ground rules

- **Keep secrets out of your context.** Never run a command that prints a secret, and never read `.env`, `.env.`*, or any file the user saved a secret to. Steps marked **User runs** are run by the user in their own terminal, not with the `!` prefix and not by you, because anything they print lands in the conversation. Every `agentengine secret set` is a user-run step.
- **Confirm before granting access.** Creating an MCP configuration and enabling writes both grant access. Before each, show the user exactly what will be created or changed and wait for an explicit yes. Don't batch these into one approval.
- **Never run commands that don't exit or need a person.** Don't use `-f` or any follow flag (`deploy logs -f`, `deploy get -f`, `logs -f`); they never exit and will hang you. `agentengine auth login`, `atlas auth login`, and `agentengine init` are interactive or state-changing, so stop and ask the user to run them.
- **Don't pass `--yes` or `--auto` to `agentengine deploy`.** `--yes` accepts billed Flex cluster defaults and IP access-list changes. `--auto` builds and then tails the deployment. Plain `agentengine deploy` run non-interactively never prompts, never runs `init`, and never starts a build; it prints any missing setup instead, which you then hand to the user.
- **Ask before changing the environment again.** The user asking for a deploy covers one `agentengine deploy`. Ask before any redeploy, and show the user any `agent.yaml` change before saving it.
- **Narrowest access by default.** Read-only is the default because the roles on the MCP configuration are the hard limit on what the agent can do in Atlas. A leaked credential, a prompt injection, or a model mistake can then read data but can't change it. Only move to a write role when the user states a concrete need (for example "it needs to create indexes on `orders` in staging"). "Might be useful" isn't a need.

## Before you start

Ask the user, rather than assuming:

- Which agent, and which environment (local, staging, production). Each environment gets its own MCP configuration and credentials. Never reuse them across environments.
- Which Atlas project the agent should see. The MCP configuration is scoped to one project.
- Whether writes are needed, and if so what for. Atlas Query Insights is read-only and must stay that way. Atlas Explorer is read-only unless both opt-ins in section 3 are done.
- Which model provider. The default is OpenAI.
- For a local environment only: their public IPv4. Ask for it. Don't look it up with an external service.

Prerequisites: `agentengine` CLI installed, Atlas CLI 1.58 or later, Node.js 24 or later, pnpm, and a model API key. Run `agentengine status`. If it says `not logged in` or `not initialized`, stop and ask the user to run `agentengine auth login` (and `agentengine init`) themselves.

## 1. Create the Atlas MCP configuration

Skip this if the environment already has a configuration and stored credentials.

1. `cp mcp-config.example.json mcp-config.json` (the copy is git-ignored). `mcp-secret-metadata.json` is checked in next to it and needs no copy. It sets how long the minted secret lasts (`secretExpiresAfterHours`).
2. Edit `mcp-config.json`:
  - Replace `{environment}` in `mcpConfigName` (for example `atlas-explorer-prod`). The example already sets the roles.
  - `YOUR_LOCAL_PUBLIC_IP`: for a **local** environment, replace it with the IPv4 the user gave you. For **staging or production**, delete that whole `{ "ipAddress": ... }` entry from `ipAccessList`. Don't leave the placeholder in, and don't put a developer's IP on a deployed configuration.
  - The two Agent Engine egress IPs are already in `ipAccessList` (see [https://www.mongodb.com/docs/agentengine/network-egress/](https://www.mongodb.com/docs/agentengine/network-egress/)). Check they still match that page, since a deployed workspace can't reach Managed MCP without them.
3. Leave the roles read-only (`GROUP_DATA_ACCESS_READ_ONLY`) unless section 3 applies.
4. Confirm no placeholders are left. This must print nothing:

```bash
grep -nE 'YOUR_LOCAL_PUBLIC_IP|\{environment\}|AGENT_ENGINE_IP' mcp-config.json
```

1. **Confirmation gate.** Show the user the final `mcp-config.json` and say in one line what it grants: the Atlas project (`GROUP_ID`), the roles, and every IP in `ipAccessList`. Wait for a yes. Don't run the next command without it.
2. Create the configuration and keep its ID. The user must already be logged in (`atlas auth login -P mcp` is interactive, so they run it). Don't run it yourself. The response includes `mcpConfigId` (the configuration's UUID) and `clientId` (the `mdb_sa_id_...` OAuth client ID). The response also has an `egressClientId`, which is managed by Atlas and is not the one to use. Neither value you need is a secret, so you can run this:

```bash
export GROUP_ID="<atlas-project-id>"

read -r MCP_CONFIG_ID CLIENT_ID <<< "$(atlas api remoteMcpConfigurations createGroupMcpConfig \
  --groupId "$GROUP_ID" --file mcp-config.json -P mcp \
  -o '{{.mcpConfigId}} {{.clientId}}')"

echo "mcpConfigId: $MCP_CONFIG_ID"
echo "clientId (ATLAS_MCP_CLIENT_ID): $CLIENT_ID"
test -n "$MCP_CONFIG_ID" -a -n "$CLIENT_ID" || echo "create failed or response missing an ID"
```

This uses the Atlas CLI's own output template, so `jq` isn't needed. Run it once. Creating the configuration again makes a duplicate.

1. **User runs:** mint the client secret. The command prints the secret, so the user runs it in their own terminal and sends the output to a private file outside the repo. Give them this, with `<atlas-project-id>` and `<mcpConfigId>` filled in. Your shell variables don't carry over to their terminal. Pass `mcpConfigId`, not `clientId`:

```bash
umask 077
atlas api remoteMcpConfigurations createGroupMcpSecret \
  --groupId "<atlas-project-id>" --mcpConfigId "<mcpConfigId>" \
  --file mcp-secret-metadata.json -P mcp -o json > ~/atlas-mcp-secret.json
```

The secret is returned once. Tell the user to open `~/atlas-mcp-secret.json` themselves, store the values in step 2, then delete the file. Don't read that file.

## 2. Store secrets on the platform

**User runs** each of these. Each prompts for the value, which stays out of the conversation:

```bash
agentengine secret set ATLAS_MCP_CLIENT_ID --workspace-scope      # the clientId from step 1
agentengine secret set ATLAS_MCP_CLIENT_SECRET --workspace-scope  # from ~/atlas-mcp-secret.json
agentengine secret set OPENAI_API_KEY
```

`secret set` writes a **project-scoped** secret by default, shared by every workspace in the Agent Engine project. Atlas Explorer and Atlas Query Insights use the same names (`ATLAS_MCP_CLIENT_ID`, `ATLAS_MCP_CLIENT_SECRET`) but should have different MCP configurations, so a project-wide value would be overwritten by whichever agent was set up last. The two Atlas secrets above therefore use `--workspace-scope`. Neither the help text nor the published docs say which scope wins when both exist, so check with `agentengine secret list` after setting them.

If the user uses another provider, they set that provider's key name instead of `OPENAI_API_KEY`. Secret names must match the names listed under `required_secrets` in `agent.yaml`. `MONGODB_URI` is injected, so don't set it. Afterwards the user deletes `~/atlas-mcp-secret.json`.

## 3. Enable writes (Atlas Explorer only, optional)

Do this only if the user has stated a concrete need for writes (see the ground rules). Query Insights never gets this step.

Writes need both of these. Leaving either out keeps the agent read-only.

1. An MCP configuration with a write-capable Atlas role such as `GROUP_DATA_ACCESS_READ_WRITE`, scoped to what the environment needs. This is a new configuration or a change to a configuration that grants access, so it needs its own confirmation gate.
2. `ALLOW_WRITE_OPERATIONS` declared under `required_secrets.aer` in `agent.yaml`, then **User runs** `agentengine secret set ALLOW_WRITE_OPERATIONS` with a non-empty value other than `false`. The checked-in manifest doesn't declare it.

**Confirmation gate.** Before changing either, show the user the role you'll grant, the Atlas project and environment it applies to, the `agent.yaml` diff, and the stated need. Say that every write tool then pauses for approval and that `$out` and `$merge` aggregations also require approval. Wait for a yes. Tell the user the `agent.yaml` change should be reviewed and committed deliberately.

## 4. Changing the model provider (optional)

Update all three together, or the deploy will start but model calls will fail:

- Provider and model in `config.ts` (`src/agent_atlas_explorer/config.ts` or `src/agent_atlas_query_insights/config.ts`).
- The provider's key under `required_secrets.aer` and `required_secrets.tools.invoke_llm`.
- The provider's API host under `network.egress` with `component: tool`.

Outbound traffic is blocked by default. The agent can reach only the hosts listed in `agent.yaml`.

## 5. Check before deploying

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
agentengine agent validate
```

`pnpm build` produces `dist/`, which is what runs on the platform. Rebuild after any source change. `agentengine agent validate` checks `agent.yaml` only (older CLIs call it `agentengine validate`). Do not edit `.agentengine/`; the CLI generates it.

Review `git diff agent.yaml` before continuing and make sure every change is intended.

## 6. Build, deploy, smoke test

```bash
agentengine build
agentengine deploy
agentengine status --verbose
agentengine invoke "List the databases in my cluster and their sizes."
```

For Atlas Query Insights, invoke it for a report instead. Its Performance Advisor needs an M10 or larger cluster with recent slow query logs.

To watch a deploy live, ask the user to run `agentengine deploy logs -f` in their own terminal. Never run it yourself.

If `status` isn't `ready`, or `invoke` fails, read [references/troubleshooting.md](references/troubleshooting.md). That file says when a redeploy is allowed: at most once per distinct cause, and never on a fast failure.

## Report back

Say what was actually done and verified: which agent and environment, which commands ran, `agentengine status` output, and whether the smoke test passed. If a step was skipped or failed, say so.