# MCP token load test

Measures two things about a deployed Atlas Explorer workspace:

- Whether a session keeps its agent sandbox between turns.
- How many Atlas MCP access tokens that traffic mints.

The Atlas MCP server allows 100 active access tokens per service account, and each token lasts 1 hour. Before the Orchestration Engine kept sandboxes for the idle TTL ([AP-7168](https://jira.mongodb.org/browse/AP-7168)), every message started new sandboxes and minted new tokens. A workspace then failed for about an hour once it hit the cap. See [EAI-2408](https://jira.mongodb.org/browse/EAI-2408), [EAI-2420](https://jira.mongodb.org/browse/EAI-2420), and [the bug report](../../docs/bug-report-sandbox-churn-mcp-tokens.md).

> **Warning: every run mints real tokens on the workspace's MCP service account.**
> `ramp` and any run that pushes past the ceiling can take that workspace down for about an hour. New conversations fail with `The agent did not become ready during startup` until the oldest tokens expire. Run those scenarios only against a dedicated MCP service account and workspace. Do not point them at a shared or customer-facing deployment.

## Setup

From the repository root, with `agentengine` on your PATH and logged in:

```bash
cp packages/agent-engine-load-test/.env.example packages/agent-engine-load-test/.env
```

Fill in the same gateway variables the Slack bot uses:

- `AGENTIC_SA_CLIENT_ID`
- `AGENTIC_SA_CLIENT_SECRET`
- `AGENTIC_PROJECT_ID`
- `AGENTIC_WORKSPACE_ID`
- `AGENTIC_BASE_URL` (optional; defaults to `https://agentengine.mongodb.com`)

`.env` is gitignored. `load` reads it from this package directory.

`fetch-logs` and `report` use the `agentengine` CLI, not the gateway credentials. `--workspace` is the CLI workspace name (default `atlas-explorer`). It must be the workspace those credentials invoke, or the report will mix one workspace's turns with another workspace's logs.

The agent has to log `[runtime-diag]` lines. Atlas Explorer does that when `diagnostics.logRuntimeLifecycle` is true in [agents/atlas-explorer/src/agent_atlas_explorer/config.ts](../../agents/atlas-explorer/src/agent_atlas_explorer/config.ts).

## Commands

Run these from the repository root. The script names already include the subcommand, so pass flags after `--`.

A normal run is load, wait about a minute for logs to arrive, fetch, then report:

```bash
pnpm --filter @repo/agent-engine-load-test load -- --scenario same-session
pnpm --filter @repo/agent-engine-load-test fetch-logs -- --run <run-id>
pnpm --filter @repo/agent-engine-load-test report -- --run <run-id>
```

`load` prints the run id. To analyze logs you already have, skip `load` and `fetch-logs`:

```bash
pnpm --filter @repo/agent-engine-load-test report -- \
  --since 2026-10-07T16:55:00.000Z \
  --until 2026-10-07T17:30:00.000Z
```

`fetch-logs` on its own accepts either `--run <id>` or `--since` and `--until`. After a `load` run it fetches from the run's start until two minutes after the run's end, so a sandbox that logs its token a little late is included.

### Scenarios

The prompt is fixed and read-only (`List my Atlas projects. Names only.`), so every successful turn calls the Atlas MCP tool.

| Scenario | What it does | Useful flags |
| --- | --- | --- |
| `same-session` | 2 turns, 30s apart. Default 1 session. | `--gap 30s`, `--sessions N` |
| `after-ttl` | 2 turns. The second waits 600s + 60s, past the default idle TTL. | `--gap 660s` |
| `ttl-probe` | Follow-ups 280s, 590s, and 620s after the previous turn, to bracket a 600s TTL. | `--gaps 280s,590s,620s` |
| `concurrency` | 6 sessions at the same time, one turn each. | `--concurrency 6` |
| `ramp` | 4 sessions at 60 per hour. Raise both for a ceiling test. | `--sessions 45 --rate 45/h` |
| `recovery-probe` | One new session every 5 minutes, up to 12, stopping at the first success. | `--interval 5m --sessions 12` |

Durations accept `ms`, `s`, `m`, and `h`. `--rate` is sessions per hour, written `45/h`.

```bash
pnpm --filter @repo/agent-engine-load-test load -- --scenario ttl-probe
pnpm --filter @repo/agent-engine-load-test load -- --scenario concurrency --concurrency 6
pnpm --filter @repo/agent-engine-load-test load -- --scenario ramp --sessions 4 --rate 60/h
```

## Reading the report

The header includes the Orchestration Engine image from `agentengine status` at the time of the run (`component_images.oe`). That is the workspace's current engine, not a historical one. A result measured on `v0.11.7` is a pre-fix result. Don't compare it with a later engine without checking this line.

Per session, the table has:

- **Agent instance.** The sandbox that served the turn. The same id on every turn means the session kept its agent sandbox.
- **First execution.** `yes` when that process logged the turn as its first execution (`n=1`). Before the fix, follow-up turns were still a process's first execution.
- **Gap.** Time since the previous turn in the session.
- **New agent sandboxes after / New tool sandboxes after.** Process starts strictly after this turn and before the next execution in the window, including another session's turn. A turn that is the last execution in the window counts every later process start.

**Same agent sandbox for every turn** is `yes` only when at least two turns ran and they all used one agent instance.

Token counts:

- **Observed** is the number of distinct token fingerprints whose `cache_updated_at` falls inside the window. The log stores a short hash, never the token.
- **Estimated mints** is the number of process starts whose token cache was empty. Each of those processes has to mint.
- **Peak active tokens** is how many of those tokens overlap during the window. An observed token counts from `cache_updated_at` until its expiry. An estimated mint counts for one hour from process start, but only when that process never logged a token. A process that both starts empty and later logs a token is not counted twice.

Observed is often lower than estimated. Sandboxes mint at startup and are then paused, before the diagnostics poll can log the token. The template now polls quickly for the first 30 seconds and checks again when the graph is built, but a workspace keeps doing this only after it is redeployed with that change. Until then, treat estimated mints as the count to trust, and use the peak as a lower bound.

**Failures** records the first `Access Token limit reached` log line, the first client error, and the first successful turn after the earlier of those two. The gap between them is the recovery time.

**Executions on a process's first execution** is the churn summary. On the Oct 7 repro this was 2 of 2 for the two-turn session, and 43 of 49 over the preceding traffic.

## Results layout

Each run is a directory under `packages/agent-engine-load-test/results/`. The directory is gitignored.

| File | Contents |
| --- | --- |
| `meta.json` | Run id, scenario, window, workspace, and the engine image. |
| `client.jsonl` | One JSON object per turn from `load`: times, session id, execution id, status, and error. |
| `logs.ndjson` | Raw log records from `fetch-logs`. |
| `report.md` | The Markdown report. |
| `report.json` | The same report as JSON. |

## Limitations

- Tool sandboxes do not log the session id. The report can count new tool processes between turns. It cannot say which tool sandbox served which session.
- `agentengine logs` accepts at most 6 hours per query. Longer windows are split.
- Tokens minted by anything else that uses the same service account (Playground, another workspace, an eval run) do not appear in these logs. A dedicated service account is the only way to make the peak match the real cap.
- The engine image is whatever `agentengine status` reports when the command runs.

## Tests

```bash
pnpm --filter @repo/agent-engine-load-test test
pnpm --filter @repo/agent-engine-load-test typecheck
```
