# @mongodb-js/atlas-agents-eval

Eval harness for LangGraph deep agents built on Agent Engine. It runs an
agent's real deep agent, with its prompt, skills and middleware, through
[`mongodb-assistant-eval`](https://mongodb-assistant-docs.prod.corp.mongodb.com/server/evaluation/library),
so suites get Braintrust tracing, scorers, a CLI and pass/fail validators.

## What's in it

- `createAgentEvalCli` builds an eval CLI from agents, datasets, models,
  fixtures, Mongo checks and validators.
- `makeAgentTask` builds the eval task for one agent definition.
- `./tools` has the tool providers. `createLocalToolProvider` starts one
  `mongodb-mcp-server` per case, with Atlas Admin API calls going to a
  shared mock (`./atlas`) and database calls going to an ephemeral `mongod`
  (`./mongo`). Nothing touches a real Atlas project.
- `createFixtureStore` and `loadAgentCasesFromFile` load your fixtures and
  YAML datasets, and reject unknown tool, fixture and Mongo check names.
- `./scorers` has the trajectory, approval, forbidden-tool and answer
  scorers.
- `./testing` has the offline test support: a mock Braintrust server, a stub
  judge and Atlas test helpers.
- `./setup` disables HTTP keep-alive. Add it to Vitest `setupFiles`.

## Commands

```sh
pnpm --filter @mongodb-js/atlas-agents-eval test
pnpm --filter @mongodb-js/atlas-agents-eval typecheck
```

The first test run downloads a `mongod` binary (about 120 MB) into
`~/.cache/mongodb-binaries`.
