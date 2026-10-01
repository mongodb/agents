# MongoDB Agentic Platform Agent Templates

Templates for MongoDB Agentic Platform agents.

This repository contains reusable starting points for building agents that work
with MongoDB and MongoDB Atlas. Each template is self-contained and includes its
own setup and deployment instructions.

## Templates

- [Atlas Explorer](agents/atlas-explorer) — An operations agent
  for exploring MongoDB data and managing Atlas resources.
  - [Talk to Atlas Explorer from Slack](apps/atlas-explorer-slack-bot) — Run the
    `@AtlasExplorer` Slack client locally with Socket Mode or deploy it to
    Vercel.

## Agent Engine layout

The root [`agent.yaml`](agent.yaml) registers each Agent Engine workspace.
Atlas Explorer lives in `agents/atlas-explorer`. Project memory settings are
in [`project-config.yaml`](project-config.yaml) next to that manifest.

From the repository root:

```bash
agentengine dev up --workspace atlas-explorer
```

From `agents/atlas-explorer`, `agentengine dev up` uses the same project config.

## Getting Started

Choose a template and follow its README for configuration, local development,
and deployment.
