# @repo/evals

Private package that runs the Atlas Explorer and Atlas Query Insights agents
through [`mongodb-assistant-eval`](https://mongodb-assistant-docs.prod.corp.mongodb.com/server/evaluation/library),
so suites get Braintrust tracing, scorers, a CLI, and pass/fail validators.

This is the harness plus the CI wiring. Real eval suites and thresholds are
separate work (EAI-2509 is the harness, EAI-2516 is CI gating).

## What's in it so far

- `src/messageMapper.ts` turns LangChain messages into the library's message
  shape, including Responses API block content.
- `src/scriptedModel.ts` is a keyless chat model that replays scripted turns,
  for tests and smoke runs.
- `src/offline/` runs the eval CLI against an in-process fake Braintrust
  server. The CLI has no offline mode and needs an API key, so offline runs
  set a dummy key and point the SDK at the fake.

- `src/evalCli.ts` builds the `evaluation` CLI for both agents. `src/cli.ts`
  is its entry point.
- `src/smoke/` is a one-case, tool-free suite that proves the CI plumbing.
  Real suites register their datasets, scorers and validators in
  `src/evalCli.ts` next to it.

## Commands

```sh
pnpm --filter @repo/evals test
pnpm --filter @repo/evals typecheck
```

Run a smoke eval against Braintrust. This needs `BRAINTRUST_API_KEY`, and
`OPENAI_API_KEY` unless you pass `--model scripted`:

```sh
pnpm eval:ci:explorer --model gpt-4.1-mini --run-id local-test
pnpm eval:ci:query-insights --model gpt-4.1-mini --run-id local-test
```

## CI

`.github/workflows/evals-atlas-explorer.yml` and
`.github/workflows/evals-atlas-query-insights.yml` run these scripts. Each
runs only when its own agent, `agent-engine-core`, `packages/evals` or the
lockfile changes. They also run weekly and on `workflow_dispatch`.

- Repository secrets: `OPENAI_API_KEY` and `BRAINTRUST_API_KEY`.
- Optional repository variable `EVAL_MODEL` sets the model. The default is
  `gpt-4.1-mini`. A model must be a key of `evalModels` in `src/evalCli.ts`.
- Fork PRs skip the job, because forks cannot read secrets.
- The scripts exit non-zero when a validator fails, which fails the job.
- The job summary lists the Braintrust experiment URLs and the validation
  result. The full log is uploaded as an artifact.
