# @repo/evals

Private package that runs LangChain-based agents through
[`mongodb-assistant-eval`](https://mongodb-assistant-docs.prod.corp.mongodb.com/server/evaluation/library),
so suites get Braintrust tracing, scorers, a CLI, and pass/fail validators.

This is the harness. Eval suites, thresholds, and CI gating are separate work
(EAI-2509 is the harness).

## What's in it

- `src/task.ts` builds the eval task for an agent. It runs the agent's real
  deep agent, with its prompt, skills and middleware, against per-case tools.
- `src/tools/` has the tool providers. `localToolProvider` starts one
  `mongodb-mcp-server` per case. Atlas Admin API calls go to a shared mock
  (`src/atlas/`) and database calls go to an ephemeral `mongod`
  (`src/mongo/`). Nothing touches a real Atlas project.
- `src/mcp/managedTools.ts` lists the server tools the harness manages. A
  contract test fails when a server upgrade adds or removes one.
- `src/cases.ts` loads YAML datasets and rejects unknown tool names.
- `src/scorers.ts` has the agent-specific scorers on top of the library's
  `AgentTrajectoryScorer`.
- `src/datasets/` has the smoke datasets. `fixtures/` has the mock Atlas
  accounts and MongoDB seeds that cases name.
- `src/messageMapper.ts`, `src/scriptedModel.ts` and `src/offline/` are the
  test support: message mapping, a keyless model that replays scripted turns,
  and a mock Braintrust server.

## Commands

```sh
pnpm --filter @repo/evals test
pnpm --filter @repo/evals typecheck
```

The first test run downloads a `mongod` binary (about 120 MB) into
`~/.cache/mongodb-binaries`.

## Running evals

The library CLI needs `BRAINTRUST_API_KEY`. Put it in the repo's root `.env`,
which `src/bin.ts` loads. Real models also need `OPENAI_API_KEY`.

```sh
# Scripted model: replays each case's input.custom.script. Needs no model key.
pnpm --filter @repo/evals eval:smoke:explorer
pnpm --filter @repo/evals eval:smoke:query-insights

# Any CLI command, for example the production model on the explorer dataset
pnpm --filter @repo/evals eval evaluation run --task explorer \
  --dataset explorer-smoke --model <model name> --validate smoke-explorer
pnpm --filter @repo/evals eval evaluation run --help
```

The unit tests run the same commands against a mock Braintrust server, so
`pnpm test` needs no keys.

## Adding a case

Cases are YAML in `src/datasets/`. `input.custom` holds `script` (turns for
the scripted model), `toolSetup` (fixture names), `allowWrites`, `approval`
and `defaultData`. `expected.custom` holds `forbiddenExecuted`,
`expectApprovalFor`, `forbiddenText`, `answerMatches` and `state`. See
`src/schemas.ts` for the exact shape.

Cases name their fixtures and never hold the data:

```yaml
toolSetup: { mockAtlas: one-project, localMongo: shop-orders }
```

Fixtures are YAML in `fixtures/atlas/` and `fixtures/mongo/`. Each
case gets a fresh copy, and the loader rejects an unknown name. Only the names
reach Braintrust. For a one-off variation, add a small fixture. Ids in `script`
and `defaultData` must match the fixture, and `expected.custom.state` paths
index into it (`atlas.projects.0...`).
