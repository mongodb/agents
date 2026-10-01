# MongoDB Agent Engine agents

A monorepo of MongoDB and Atlas agents that run on Agent Engine, plus the
libraries and chat clients that go with them. It is not a template repository.
See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, scripts, and CI.

## Agents and apps

- [`agents/atlas-explorer`](agents/atlas-explorer/README.md): the Atlas
  Explorer agent, for exploring MongoDB data and managing Atlas resources.
- [`apps/atlas-explorer-slack-bot`](apps/atlas-explorer-slack-bot/README.md):
  the `@AtlasExplorer` Slack client, for local Socket Mode or Vercel.
- [`agents/query-analysis`](agents/query-analysis/README.md): a read-only
  agent that explains slow queries from the Atlas Performance Advisor.

## Packages

- [`packages/agent-engine-core`](packages/agent-engine-core/README.md): the
  shared agent runtime.
- [`packages/atlas-explorer-agent`](packages/atlas-explorer-agent/README.md):
  Atlas Explorer's tool policy and prompts.
- [`packages/query-analysis-agent`](packages/query-analysis-agent/README.md):
  the Query Analysis agent's tool policy.
- [`packages/agent-engine-chat`](packages/agent-engine-chat/README.md): the
  Chat SDK client library for Agent Engine agents.

## Scripts

- [`scripts/seed-pa-slow-queries`](scripts/seed-pa-slow-queries/README.md):
  loads slow-query data into an Atlas cluster for Performance Advisor.
