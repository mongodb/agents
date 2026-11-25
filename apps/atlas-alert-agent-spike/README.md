# Atlas alert to agent to Slack (spike)

Spike for [EAI-2488](https://jira.mongodb.org/browse/EAI-2488). Not
production code. It shows one way to go from an Atlas alert to an Agent
Engine agent and back to Slack.

```text
Atlas alert --webhook--> this function --invoke--> agent --> Slack
```

## Why a separate receiver

- Atlas Triggers can't receive alerts. They only fire on database changes
  or a schedule. [Triggers][triggers]
- App Services HTTPS endpoints reached end of life on 2025-09-30, so
  they can't be the webhook target either. [Deprecation][deprecation]
- The alert webhook can't call the Agent Engine invoke endpoint directly.
  The gateway client here exchanges service-account credentials for a
  short-lived OAuth token first (`serviceAccountTokenProvider.ts`). Atlas
  can't run that exchange. Its docs say the secret only signs the body, and
  custom header templates could only carry a static value, which would
  expire. [Webhook docs][webhook]

So a small function sits in the middle. It checks the Atlas signature,
returns `202` right away (Atlas treats non-2xx as a failure), then calls
the agent with `AgentEngineClient` and posts the reply with Slack's
`chat.postMessage`.

## Run it

```bash
pnpm --filter @repo/atlas-alert-agent-spike test
```

Environment variables:

| Variable | Purpose |
| --- | --- |
| `ATLAS_WEBHOOK_SECRET` | Secret set in the Atlas webhook integration |
| `ATLAS_WEBHOOK_URL_TOKEN` | Optional. Expected in `?token=` on the URL |
| `SLACK_BOT_TOKEN` | Bot token with `chat:write` |
| `SLACK_ALERT_CHANNEL_ID` | Channel to post in. Invite the bot first |
| `AGENTIC_PROJECT_ID`, `AGENTIC_WORKSPACE_ID` | Agent Engine target |
| `AGENTIC_SA_CLIENT_ID`, `AGENTIC_SA_CLIENT_SECRET` | Service account |
| `AGENTIC_BASE_URL` | Optional. Defaults to the hosted platform |
| `AGENTIC_INVOKE_TARGET` | Optional. `local` skips the service account |

Deploy the function the way the Slack bot is deployed (`vercel.json` is
the same shape), then in Atlas:

1. Project Settings, Integrations, Webhook Settings. Set the URL
   (`https://<host>/api/webhooks/atlas-alert`) and the secret.
2. Add a Webhook notifier to an alert configuration. Atlas can't send
   test alerts, so use an easy threshold on a test cluster.

Try it without Atlas by sending a signed request:

```bash
BODY='{"id":"a1","eventTypeName":"OUTSIDE_METRIC_THRESHOLD","clusterName":"Cluster0","humanReadable":"Disk space used is 95%"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha1 -hmac "$ATLAS_WEBHOOK_SECRET" -binary | base64)
curl -i -X POST "$URL/api/webhooks/atlas-alert" \
  -H "X-MMS-Event: alert.open" -H "X-MMS-Signature: $SIG" -d "$BODY"
```

## Known gaps

- Not run against real Atlas, Agent Engine, or Slack. Only unit tests ran.
- Posts to Slack from the receiver. The agent posting itself is covered
  in the earlier runtime spike notes and is untested.
- No retry dedupe, rate limiting, or alert grouping. Atlas can resend an
  open alert, which would post again.
- The agent must be able to read the affected cluster. Which tools and
  access that needs is not checked.
- A write approval pause is reported in Slack but can't be resumed.

[triggers]: https://www.mongodb.com/docs/atlas/atlas-ui/triggers/
[deprecation]: https://www.mongodb.com/docs/atlas/app-services/deprecation/
[webhook]: https://www.mongodb.com/docs/atlas/tutorial/webhook-integration/
