# @repo/evals

Private package that runs the Atlas Explorer and Atlas Query Insights agents
through [`mongodb-assistant-eval`](https://mongodb-assistant-docs.prod.corp.mongodb.com/server/evaluation/library),
so suites get Braintrust tracing, scorers, a CLI, and pass/fail validators.

This is the harness. Eval suites, thresholds, and CI gating are separate work
(EAI-2509 is the harness).

## What's in it so far

- `src/messageMapper.ts` turns LangChain messages into the library's message
  shape, including Responses API block content.
- `src/scriptedModel.ts` is a keyless chat model that replays scripted turns,
  for tests and smoke runs.
- `src/offline/` runs the eval CLI against an in-process fake Braintrust
  server. The CLI has no offline mode and needs an API key, so offline runs
  set a dummy key and point the SDK at the fake.

## Commands

```sh
pnpm --filter @repo/evals test
pnpm --filter @repo/evals typecheck
```
