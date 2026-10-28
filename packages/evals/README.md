# @repo/evals

Private package that runs LangChain-based agents through
[`mongodb-assistant-eval`](https://mongodb-assistant-docs.prod.corp.mongodb.com/server/evaluation/library),
so suites get Braintrust tracing, scorers, a CLI, and pass/fail validators.

## Commands

```sh
pnpm --filter @repo/evals test
pnpm --filter @repo/evals typecheck
```
