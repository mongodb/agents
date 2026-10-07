# Troubleshoot a failed or stuck deployment

For a deploy that failed, is stuck, or succeeded but the agent doesn't work. Diagnosis is read-only until a section below says otherwise.

## Rules

- **Read-only by default.** Everything in the survey only reads. Anything that changes the environment needs the user's confirmation first: `agentengine deploy`, `deploy cancel`, `build cancel`, `build promote`, `secret set`, `secret sync`, `secret delete`, and any edit to `agent.yaml`. Never pass `--yes` or `--auto` to `deploy`. Show the user the `agent.yaml` diff before saving the edit.
- **Never use `-f` or any follow flag** (`deploy logs -f`, `deploy get -f`, `logs -f`). They never exit and will hang you. If live output would help, ask the user to run it in their own terminal and report back.
- **Interactive commands are the user's.** `agentengine auth login` needs a browser or prompt you can't complete, so stop and ask the user to run it. Leave `agentengine init` to the user as well: it picks an organization and project and registers the workspace on the platform.
- **You can't read operator logs.** Orchestration-engine and memory-server logs are platform operator logs, available in the admin UI or `GET /api/v1/operator-logs` with deploy-viewer access, and you have no way to get that access. Tell the user to check them and report what they see.
- **Redeploy at most once per distinct cause**, only where a section below says to, and never on the fast-fail branch. If a redeploy doesn't change the symptom, stop and escalate. Don't try again.

## Prerequisites

```bash
agentengine status
```

If it says `not logged in` or `not initialized`, stop and ask the user to run `agentengine auth login` and `agentengine init`. Confirm the workspace is the agent they meant to deploy.

## Survey

Run in order. Each looks at a different layer.

```bash
agentengine status --verbose                    # state, component health, deployment ID, image
agentengine deploy logs --severity error        # error events from the latest deploy
agentengine logs --source agent --level error --since 30m
agentengine logs --source tool --level error --since 30m
agentengine build list                          # only if the build failed
agentengine build logs <build-id>
```

## Route


| Symptom                                        | Go to                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy failed in under 5 minutes               | [Fast fail](#fast-fail)                                                                                                                      |
| Deploy timed out after about 30 minutes        | [Timed out](#timed-out)                                                                                                                      |
| `ImagePullBackOff` in deploy events            | [Stale image](#stale-image)                                                                                                                  |
| Build failed                                   | [Build failed](#build-failed)                                                                                                                |
| `code = Unimplemented` on invoke               | [Routing mismatch](#routing-mismatch)                                                                                                        |
| `status` is `degraded`                         | Find the unhealthy component in `status --verbose`, then check its logs                                                                      |
| Agent runs but model or MCP calls fail         | [Secret missing](#secret-missing-or-misnamed), [Blocked host](#blocked-outbound-host), [MCP rejects the agent](#atlas-mcp-rejects-the-agent) |
| Read-only when it shouldn't be, or the reverse | [Write access](#write-access-is-wrong)                                                                                                       |
| Anything in [Escalate](#escalate)              | Escalate                                                                                                                                     |


## Fast fail

A platform dependency couldn't start, so the agent exited and the deploy failed in under 5 minutes. **Do not redeploy.** The same failure will recur.

1. Show the user `agentengine deploy logs --severity error`.
2. Ask the user to check the orchestration-engine operator logs and report back.
3. Once a cause is found, follow the section that matches it.

## Timed out

A component never became healthy. `agentengine deploy logs` shows which one stalled. Check that component's logs, then follow the matching section.

## Stale image

The old image was removed from the registry. With the user's confirmation, run `agentengine deploy` once for a fresh image. If `ImagePullBackOff` persists, [escalate](#escalate).

## Build failed

Run `agentengine build logs <build-id>` and look for dependency or syntax errors. `pnpm build` must succeed locally first, because it produces the `dist/` that runs on the platform.

## Routing mismatch

`status` says `ready` but invoke returns `code = Unimplemented`. A workspace migration left routing inconsistent. With the user's confirmation, run `agentengine deploy` once. If it persists, [escalate](#escalate).

## Secret missing or misnamed

The agent starts but model or MCP calls fail with auth errors.

- Every secret the agent reads must be both set and listed in `agent.yaml` under `required_secrets`. Check both.
- The model key must be listed under `required_secrets.aer` and `required_secrets.tools.invoke_llm`. The platform runs model calls in a tool pod.
- The Atlas credentials must be listed under `required_secrets.aer` and `required_secrets.tools."mongodb__*"`.
- `MONGODB_URI` is injected into every workload. Don't set or list it.

If a secret is missing or wrong, the user sets it using section 2 of `../SKILL.md`. After an `agent.yaml` or secret change, redeploy once with the user's confirmation.

## Blocked outbound host

Calls to a model provider or Atlas fail only when deployed. Outbound traffic is blocked by default, so the host must be in `network.egress`.

- Atlas needs `cloud.mongodb.com` and `mcp.mongodb.com`.
- The model provider's API host needs an entry with `component: tool`. Switching providers in `config.ts` without adding its host here is a common cause.

Show the user the `agent.yaml` diff, then redeploy once with their confirmation.

## Atlas MCP rejects the agent

A deployed agent can't call Managed MCP but local works. These come from how the READMEs say the configuration works, not from observed logs.

- The MCP configuration's `ipAccessList` must include the Agent Engine egress IPs ([https://www.mongodb.com/docs/agentengine/network-egress/](https://www.mongodb.com/docs/agentengine/network-egress/)). The example ships with them; check they weren't removed.
- `ATLAS_MCP_CLIENT_ID` must be the `clientId`, and the secret must have been minted with `mcpConfigId`, not `clientId`. If either is wrong, the user redoes steps 1 and 2 of `../SKILL.md`.
- The configuration must belong to the Atlas project that holds the data.
- Each environment needs its own configuration and credentials.

### MCP documentation

The public MCP docs cover setup but not error diagnosis. They have no 401/403 guidance. Point the user to these, and don't invent error explanations from them:

- [MCP Access Models](https://www.mongodb.com/docs/mcp-server/remote-mcp/access-models.md): what programmatic access through an MCP configuration is, and who can create one. Our agents use the programmatic model, not user-delegated access.
- [Get started: configure an MCP configuration](https://www.mongodb.com/docs/mcp-server/get-started.md): the Atlas CLI steps for creating a configuration and a client secret.
- [Rate limits](https://www.mongodb.com/docs/mcp-server/remote-mcp/rate-limits.md): requests are limited per IP and per user, and the server returns HTTP 429 when a limit is exceeded. Wait and retry with backoff; there is no way to request a higher limit.

Don't send the user to the "Troubleshoot MongoDB MCP Server" page. It covers the self-run local MCP server, which these agents don't use.

## Write access is wrong

Writes need both a write-capable MCP role and `ALLOW_WRITE_OPERATIONS` declared under `required_secrets.aer` and set as a secret. Missing either keeps the agent read-only. The procedure and its confirmation gate are in `../SKILL.md`, section 3, "Enable writes".

## Escalate

Escalate to MongoDB Support ([https://support.mongodb.com/welcome](https://support.mongodb.com/welcome)) on any of these. They indicate platform-side problems:

- `exec: --work: executable file not found` in deploy events.
- `ImagePullBackOff` persists after a fresh deploy.
- Deploys fail repeatedly with no errors in workspace logs.
- `status` shows `not_deployed` right after deploying.
- All components are healthy but the agent is unreachable.

Agent Engine is in Public Preview and has no SLA, so say so when you hand off.

**Build the support bundle with error-level data only:**

```bash
mkdir -p ~/agentengine-support && cd ~/agentengine-support
agentengine status --verbose --json > status.json
agentengine deploy logs --severity error --json > deploy-errors.json
agentengine logs --level error --all --since 2h --json > runtime-errors.json
agentengine deploy list --limit 5 --json > deploy-history.json
```

Don't use `logs --all` without `--level error`, and don't open or print these files. Tell the user where they are. The user reviews them before sending anything, because error logs can still contain data from their cluster. Include the workspace ID, project ID and deployment ID from `status.json`.

## When it's fixed

Don't call it fixed because a deploy command exited cleanly. Run:

```bash
agentengine status --verbose
agentengine invoke "<the smoke-test prompt from ../SKILL.md, section 7>"
```

Then report the cause you found, what changed (files, secret names, and whether a redeploy ran), and the `status` and `invoke` results. If you couldn't find a cause or the symptom remains, say so and escalate.