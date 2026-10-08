# MongoDB Agents

Agent templates for MongoDB Atlas that you can deploy to
[Atlas Agent Engine](https://www.mongodb.com/docs/agentengine/).

Each template already includes what an Atlas agent needs beyond a prompt:
credential handling, access scoping, tool orchestration, and approval flows. The
templates are built on the
[MongoDB MCP Server](https://www.mongodb.com/docs/mcp-server/) and
[MongoDB Agent Skills](https://www.mongodb.com/docs/agent-skills). You bring a
model API key, choose what the agent can access, and deploy it.

![From template to running agent: pick a template from mongodb/agents, set your Atlas credential, model, and agent.yaml, deploy with the agentengine CLI, and run on Atlas Agent Engine, which connects to Atlas and to the Playground, CLI, and Slack.](docs/images/architecture.svg)

> [!NOTE]
> Atlas Agent Engine is in Public Preview. Review the
> [Agent Engine limitations](https://www.mongodb.com/docs/agentengine/reference/limitations/)
> before you deploy an agent against a production workload.

## Agents

| Agent | What it does | Status |
| --- | --- | --- |
| [Atlas Explorer](#atlas-explorer) | A conversational agent for questions and everyday workflows across your Atlas environment, such as clusters, alerts, schemas, and data. | Available |
| [Atlas Query Insights](#atlas-query-insights) | A workflow agent that produces a slow-query report for an Atlas cluster, based on Performance Advisor. | Available |

## Get started

These steps deploy Atlas Explorer. Atlas Query Insights follows the same steps
from `agents/atlas-query-insights`. Each agent's README covers every step in detail:
[Atlas Explorer](agents/atlas-explorer),
[Atlas Query Insights](agents/atlas-query-insights).

<details>
<summary><strong>Prerequisites</strong></summary>

- An Atlas account and a project that holds the data you want to explore
- The [`agentengine` CLI](https://www.mongodb.com/docs/agentengine/build/install-authenticate/),
  installed and authenticated
- [Atlas CLI](https://www.mongodb.com/docs/atlas/cli/current/) 1.58 or later
- Node.js 24 or later, and [pnpm](https://pnpm.io/)
- Docker, to run the agent locally
- An API key for your model provider

</details>

### 1. Clone and install

```bash
git clone https://github.com/mongodb/agents.git
cd agents/agents/atlas-explorer
cp .env.example .env
cp mcp-config.example.json mcp-config.json
pnpm install
```

### 2. Set the agent's boundaries

Create an Atlas MCP configuration for one Atlas project with the Atlas CLI.
The roles you give that configuration decide what the agent can see and do.
The example grants read-only access. Before you create it, add your IP
addresses to the access list in `mcp-config.json`. Add the client ID and
secret it returns to `.env`, along with your model API key.

Atlas Explorer uses OpenAI by default. To use Anthropic, Gemini, or Cerebras
instead, change the provider and model in
`src/agent_atlas_explorer/config.ts`. Then update `agent.yaml` with that
provider's API key name and API host, because the agent can reach only the
hosts that `agent.yaml` allows.

### 3. Test it locally

```bash
pnpm build
agentengine dev up
```

Open the Playground at http://localhost:3000 and ask a question, such as
"Which of my clusters have alerts?"

### 4. Deploy to Atlas Agent Engine

Store the same credentials as platform secrets, then build and deploy. If
you use another model provider, set its API key instead of `OPENAI_API_KEY`.

```bash
agentengine secret set ATLAS_MCP_CLIENT_ID
agentengine secret set ATLAS_MCP_CLIENT_SECRET
agentengine secret set OPENAI_API_KEY
agentengine build
agentengine deploy
```

Then call the deployed agent:

```bash
agentengine invoke "List the databases in my cluster and their sizes."
```

To learn more, see
[Deploy your build](https://www.mongodb.com/docs/agentengine/deploy/deploy-build/)
and the [`agentengine` CLI reference](https://www.mongodb.com/docs/agentengine/cli/agentengine/).

## The agents

### Atlas Explorer

Atlas Explorer answers questions about your Atlas environment and helps with
everyday Atlas tasks. It connects to Atlas through the MongoDB MCP Server. When
it needs specialist guidance, such as query optimization or schema design, it
loads the matching MongoDB Agent Skill.

Try asking:

- "What does the schema of the `orders` collection look like?"
- "Why is this query slow, and what index would help?"
- "How many orders have no shipping address?"

See the [Atlas Explorer README](agents/atlas-explorer) for setup and configuration details.

### Atlas Query Insights

Atlas Query Insights explains which slow queries on a cluster matter most and
what to look at next. It reads slow query logs and index suggestions from
[Performance Advisor](https://www.mongodb.com/docs/atlas/performance-advisor/),
then reports on the highest-impact query shapes. It's read-only by design. It
can recommend an index, but it can't create one. Performance Advisor requires
an M10 or larger cluster.

For how the report is built, what it's based on, and how to configure it, see
the [Atlas Query Insights README](agents/atlas-query-insights).

### Safe by default

Agents that can see production data need clear limits. Both agents set those
limits from the start.

- **Their own Atlas identity.** Each agent connects to Atlas with its own
  programmatic identity for one Atlas project, and you choose its roles.
- **Read-only by default.** The example configurations grant read-only
  access. Atlas Explorer can be set up to write, with your approval for each
  write tool. Atlas Query Insights can't write.
- **No shell access.** Neither agent can run shell commands in its sandbox.

## Why Atlas Agent Engine

Atlas Agent Engine is the managed runtime for these agents. It handles the
infrastructure you would otherwise build and maintain yourself:

| Capability | How the templates use it |
| --- | --- |
| [Secrets](https://www.mongodb.com/docs/agentengine/deploy/provision-secrets/) and sandboxing | Atlas credentials and model API keys are stored as platform secrets, not in your code. Model and MCP calls run in a tool sandbox, separate from the agent. |
| [Network egress policies](https://www.mongodb.com/docs/agentengine/network-egress/) | Outbound traffic is blocked by default. Each sandbox can reach only the hosts that `agent.yaml` allows, such as Atlas and your model provider. |
| Durable sessions | Agent Engine checkpoints each session. An agent can pause for your approval and resume where it left off. |
| [Traces](https://www.mongodb.com/docs/agentengine/manage/inspect-traces/) and [monitoring](https://www.mongodb.com/docs/agentengine/manage/monitor/) | You can inspect each run's model calls, tool calls, and errors. |

Agent Engine also offers a local
[Playground](https://www.mongodb.com/docs/agentengine/deploy/test/),
[service accounts](https://www.mongodb.com/docs/agentengine/api-keys-service-accounts/)
for calling agents from other apps,
[agent memory](https://www.mongodb.com/docs/agentengine/add-features/memory-types/),
a [policy engine](https://www.mongodb.com/docs/agentengine/manage/governance/policy-engine/),
and more. See the [Agent Engine documentation](https://www.mongodb.com/docs/agentengine/)
for the full list.

## Example: talk to Atlas Explorer from Slack

[`apps/atlas-explorer-slack-bot`](apps/atlas-explorer-slack-bot) is an
example of how to connect a deployed agent to the tools your team already
uses. It calls Atlas Explorer on Agent Engine with a service account. You can
ask questions in a channel or DM, approve or reject proposed writes, and post
read-only reports on a schedule with Slack Workflow Builder.

This bot is an example to learn from and adapt. It isn't a managed Slack app.
You host and operate it yourself. Read these limitations before you use it:

> [!IMPORTANT]
> The Slack bot connects to Atlas with **one shared programmatic identity**.
> It does not use each Slack user's own Atlas permissions.

- An allowlist of Slack users controls who can message the bot. The bot won't
  start without one.
- Anyone on the allowlist can reach everything that the shared identity can
  reach. Give that identity only the roles every allowlisted user should
  have.
- Only the user who requested a write can approve or reject it.
- When deployed, the bot needs its own host and its own MongoDB database to
  store thread state. Run locally, it can start a temporary database instead.

## What to expect

These templates are for teams that want to run their own agents and control
how they're set up.

- **You set it up, and you own it.** There's no setup option in the Atlas
  UI. You choose the agent's Atlas access and model provider, then deploy it
  to your own Agent Engine project with the `agentengine` CLI. You keep
  control of the code, the credentials, and where the agent runs.
- **Atlas only.** The agents depend on Atlas-hosted services such as the
  Atlas MCP Server. They don't support MongoDB Enterprise Advanced,
  on-premises deployments, or Atlas for Government.
- **Built for Atlas Agent Engine.** You can fork the code and adapt it under
  the Apache 2.0 license. However, the deployment steps in this repository
  cover only Atlas Agent Engine and the `agentengine` CLI.
- **Each MCP configuration has an hourly capacity limit.** Atlas limits how
  many access tokens one service account can have active. Agent Engine mints
  two tokens each time a new conversation starts, and a
  conversation that has been idle for 10 minutes starts new processes when its
  next message arrives. That works out to an expected 40 to 50 new or resumed
  conversations per hour, shared by every user of the configuration. When the
  limit is reached, new conversations fail until older tokens expire, about an
  hour later. For details, see
  [Access token limit](agents/atlas-explorer/README.md#access-token-limit).
- **Slack is an optional example.** You host the Slack bot yourself. Everyone
  on its allowlist shares one Atlas identity instead of using their own Atlas
  permissions. For details, see
  [Example: talk to Atlas Explorer from Slack](#example-talk-to-atlas-explorer-from-slack).
  The bot is built on [Chat SDK](https://chat-sdk.dev), so you can adapt it to
  other chat platforms.

## Contributing

To learn about the repository layout, local development, and tests, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Feedback

[Open an issue](https://github.com/mongodb/agents/issues).

## License

[Apache 2.0](LICENSE)
