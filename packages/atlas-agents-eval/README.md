# @mongodb-js/atlas-agents-eval

Eval harness for LangGraph deep agents built on Agent Engine. It runs an
agent's real deep agent, with its prompt, skills and middleware, through
[`mongodb-assistant-eval`](https://mongodb-assistant-docs.prod.corp.mongodb.com/server/evaluation/library),
so suites get Braintrust tracing, scorers, a CLI and pass/fail validators.

## Install

```bash
npm install --save-dev @mongodb-js/atlas-agents-eval
```

Peer dependencies are installed automatically by npm 7 and later. They
include the LangChain and Agent Engine packages your agent already uses,
`mongodb-assistant-eval` and its model and Slack reporter packages, which
its CLI loads on import.

If you type-check without `skipLibCheck`, also install `@types/yargs` and
add the `dom` lib: `mongodb-assistant-eval` and `@langchain/langgraph-sdk`
types need them.

## Quick start

```ts
import {
  createAgentEvalCli,
  createFixtureStore,
} from "@mongodb-js/atlas-agents-eval";

const cli = createAgentEvalCli({
  projectName: "my-agent",
  agents: { "my-agent": myAgent },
  datasets: {
    smoke: { description: "Smoke cases", file: "datasets/smoke.yml" },
  },
  fixtures: createFixtureStore({ dir: "fixtures" }),
  validators: { smoke: { NoForbiddenExecuted: 1 } },
});
await cli.parseAsync();
```

`myAgent` is an `AgentDefinition`. It names the agent and its directory
(its `skills/` are loaded from there), says whether it supports writes and
how its input guard runs, and builds its deep agent options from the
case's tools. The built-in `scripted` model replays each case's
`input.custom.script`, so a smoke run needs no model key.

## TLS

The mock Atlas Admin API serves HTTPS with a self-signed certificate. The
harness passes its CA to the `mongodb-mcp-server` child through
`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` and `--use-system-ca`, which works
on Linux. On macOS the system store is the Keychain, which ignores those
variables, so the harness sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for the
child only. The child only talks to the localhost mock.

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
