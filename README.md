# MongoDB Agents

Agent templates for MongoDB Atlas that you can deploy to
[MongoDB Atlas Agent Engine](https://www.mongodb.com/docs/agentengine/).

Each template already includes what an Atlas agent needs beyond a prompt:
credential handling, access scoping, tool orchestration, and approval flows. The
templates are built on the
[MongoDB MCP Server](https://www.mongodb.com/docs/mcp-server/) and
[MongoDB Agent Skills](https://www.mongodb.com/docs/agent-skills). You bring a
model API key, choose what the agent can access, and deploy it.

![From template to running agent: open templates from mongodb/agents, your settings (Atlas credential, model provider, secrets and hosts), deploy with the agentengine CLI, and run on Atlas Agent Engine, which connects to Atlas MCP tools and to user surfaces such as the Playground, CLI, and Slack.](docs/images/architecture.png)

> [!NOTE]
> Atlas Agent Engine is in Public Preview. Review the
> [Agent Engine limitations](https://www.mongodb.com/docs/agentengine/reference/limitations/)
> before you deploy an agent against a production workload.

## Agents

| Agent | What it does | Status |
| --- | --- | --- |
| [MongoDB Atlas Explorer](#mongodb-atlas-explorer) | A conversational agent for questions and everyday workflows across your Atlas environment, such as clusters, alerts, schemas, and data. | Available |
| [MongoDB Atlas Query Insights](#mongodb-atlas-query-insights) | A workflow agent that produces a slow-query report for an Atlas cluster, based on Performance Advisor. | Available |

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
secret it returns to `.env`, along with your model API key. The example
config and the Atlas CLI steps are in each agent's README:
[Atlas Explorer](agents/atlas-explorer/README.md#configure) or
[Atlas Query Insights](agents/atlas-query-insights/README.md#configure).

The agents use OpenAI by default. OpenAI and Anthropic Claude models are the
verified providers. To switch provider, see the README for each agent in
[`agents/`](agents/).

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

### MongoDB Atlas Explorer

Atlas Explorer answers questions about your Atlas environment and helps with
everyday Atlas tasks. It connects to Atlas through the MongoDB MCP Server. When
it needs specialist guidance, such as query optimization or schema design, it
loads the matching MongoDB Agent Skill.

Try asking:

- "What does the schema of the `orders` collection look like?"
- "Why is this query slow, and what index would help?"
- "How many orders have no shipping address?"

See the [Atlas Explorer README](agents/atlas-explorer) for setup and configuration details.

### MongoDB Atlas Query Insights

Atlas Query Insights explains which slow queries on a cluster matter most and
what to look at next. It reads slow query logs and index suggestions from
[Performance Advisor](https://www.mongodb.com/docs/atlas/performance-advisor/),
then reports on the highest-impact query shapes. It's read-only by design. It
can recommend an index, but it can't create one. Performance Advisor requires
an M10 or larger cluster.

For how the report is built, what it's based on, and how to configure it, see
the [Atlas Query Insights README](agents/atlas-query-insights).

### Built-in guardrails

Agents that can see production data need clear limits. Both agents set those
limits from the start.

- **Their own Atlas identity.** Each agent connects to Atlas with its own
  programmatic identity for one Atlas project, and you choose its roles. Atlas
  authorizes that identity, not the person chatting with the agent, so anyone
  who can reach an agent can use everything its roles allow. Give the agent
  only the roles that all of its users should have. The Atlas MCP Server
  doesn't currently support per-user sign-in (OIDC) for custom clients like
  these agents.
- **Read-only by default.** The example configurations grant read-only
  access. Atlas Explorer can be set up to write, with your approval for each
  write tool. Atlas Query Insights can't write.
- **No shell access.** Neither agent can run shell commands in its sandbox.
- **Prompt injection can't be fully prevented.** Text in your data or in chat
  messages can contain instructions aimed at the model. The templates limit
  what such text can do: the agent reads only what its roles allow, every
  write needs approval, and the egress policy blocks traffic to hosts that
  `agent.yaml` doesn't list. You decide what each agent can access, so review
  its roles and allowed hosts before you deploy it.
- **Input guard.** Each agent redacts pasted credentials from the user's
  message before the model sees it, and refuses messages that are too long to
  screen. It doesn't screen tool output. See
  [Input guard](packages/agent-engine-core/src/inputGuard.ts).

## Why MongoDB Atlas Agent Engine

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

## Example: talk to MongoDB Atlas Explorer from Slack

[`apps/atlas-explorer-slack-bot`](apps/atlas-explorer-slack-bot) is an
example of how to connect a deployed agent to the tools your team already
uses. It is a thin Slack app for Atlas Explorer built on
[`packages/agent-engine-chat`](packages/agent-engine-chat)
(`@repo/agent-engine-chat`), the general-purpose library that connects any
Agent Engine workspace to [Chat SDK](https://chat-sdk.dev) platforms. It calls
Atlas Explorer on Agent Engine with a service account. You can ask questions in
a channel or DM, approve or reject proposed writes, and post read-only reports
on a schedule with Slack Workflow Builder.

To connect [Atlas Query Insights](agents/atlas-query-insights) or another agent
to Slack (for example, for on-demand slow-query questions or scheduled Workflow
Builder reports), build a small app around
[`packages/agent-engine-chat`](packages/agent-engine-chat) using
`apps/atlas-explorer-slack-bot` as a template.

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
  hour later. The Slack bot caps new sessions per hour and replies with a clear
  message instead of failing. For details, see
  [Access token limit](agents/atlas-explorer/README.md#access-token-limit)
  and the
  [Slack bot's session limit](apps/atlas-explorer-slack-bot/README.md#session-limit).
- **Slack is an optional example.** [`apps/atlas-explorer-slack-bot`](apps/atlas-explorer-slack-bot)
  is a self-hosted Slack app built on
  [`packages/agent-engine-chat`](packages/agent-engine-chat) and
  [Chat SDK](https://chat-sdk.dev), so you can connect other Agent Engine
  workspaces or adapt it to other chat platforms. See
  [Example: talk to MongoDB Atlas Explorer from Slack](#example-talk-to-mongodb-atlas-explorer-from-slack).

### Your data

- **Traces and conversations include your data.** Agent Engine stores every
  conversation and trace in your project. They can include database and
  collection names, field names, and documents the agent reads. Only people
  with access to your project can see them, and you are responsible for
  governing that data. See
  [Inspect traces](https://www.mongodb.com/docs/agentengine/manage/inspect-traces/).
- **Your model provider sees prompts and tool results.** That includes query
  results the agent reads. Choose a provider that meets your data policy.

## Skills for your coding agent

The repository includes skills in [`.agents/skills`](.agents/skills) for working
with Atlas Explorer and Atlas Query Insights, plus general skills for Atlas
Agent Engine:

| Skill | Use it to |
| ----- | --------- |
| [`deploy-mongodb-agents`](.agents/skills/deploy-mongodb-agents) | Deploy or troubleshoot Atlas Explorer or Atlas Query Insights: create the MCP configuration, set secrets, build, deploy, and diagnose a failed deploy or new conversations that fail to start. |
| [`atlas-agent-engine`](.agents/skills/atlas-agent-engine) | Edit the TypeScript agents in this repo (`atlas-explorer`, `atlas-query-insights`): `agent.yaml`, tool allowlists, approval middleware, and the agent libraries. |
| [`atlas-agent-engine-docs`](.agents/skills/atlas-agent-engine-docs) | Answer general questions about the `agentengine` CLI and platform from current documentation. |
| [`agent-engine-troubleshoot-deploy`](.agents/skills/agent-engine-troubleshoot-deploy) | Diagnose a failed or stuck deployment for other Agent Engine workspaces from status, deploy events, and runtime logs (for Atlas Explorer or Atlas Query Insights, use `deploy-mongodb-agents`). |
| [`agent-engine-feature-validations`](.agents/skills/agent-engine-feature-validations) | Check Python agent framework code (LangGraph and Google ADK) against the shapes the SDK supports before you build or deploy. |

## Contributing

To learn about the repository layout, local development, and tests, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Feedback

We want to hear what worked and what didn't, including setup friction and
use cases you'd like covered.
[Open an issue](https://github.com/mongodb/agents/issues).

## License

[Apache 2.0](LICENSE)
