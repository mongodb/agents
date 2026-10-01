# AtlasExplorer Chat Bot

`@AtlasExplorer` is a [Vercel Chat SDK](https://chat-sdk.dev) client for the
existing [Magenta Atlas Explorer agent](../../agents/atlas-explorer). Shared
handlers contain the conversation, delivery, and human-review behavior; the
official `@chat-adapter/slack` package contains Slack transport behavior. This
keeps the core ready for another Chat SDK adapter without duplicating the
Agentic workflow.

Conversation handling, the Agent Engine client, and thread storage live in
[`@repo/agent-engine-chat`](../../packages/agent-engine-chat). This app
keeps Slack transport, Socket Mode, the Vercel webhook, and Atlas Explorer
copy.

The bot does not run LangGraph, MCP, or Atlas credentials. It sends normalized
chat messages to the Agentic Platform invocation API, maps Chat SDK threads to
Agentic sessions, and presents portable Approve/Reject cards when Atlas
Explorer suspends for human review.

The initial integration uses the Magenta workspace's shared Atlas MCP identity.
Every allowlisted Slack user therefore has the same Atlas access as that
workspace; access is not scoped to each user's Atlas identity.

## Prerequisites

- Node.js 22 and pnpm
- A Slack workspace where you can create and install an app
- Either a deployed Atlas Explorer workspace and project-scoped Agentic
  service-account credentials, or a local Atlas Explorer `agentengine dev` stack
- MongoDB 5.0+ in production for Chat SDK state, durable workflow state, and
  partial TTL retention indexes. Local Socket Mode can start an ephemeral
  MongoDB automatically.

Configure and verify the Atlas Explorer agent first. Its
[README](../../agents/atlas-explorer/README.md) covers MCP and model secrets.

```bash
cd ../../agents/atlas-explorer
agentengine build
agentengine deploy
agentengine service-account create atlas-explorer-slack-bot \
  --project-id <project-id> \
  --role AGENT_DEVELOPER \
  --secret-expires-in 2160h
agentengine invoke --json "List the Atlas projects I can access"
```

For a deployed agent, the JSON probe confirms the project/workspace target and
the current `session_id` invocation contract before Slack is involved. Save the
service-account client secret when it is displayed; it is shown only once. The
Slack bot exchanges the client ID and secret at `/api/v1/oauth/token`, caches
the returned short-lived bearer token, and refreshes it based on the token's
reported lifetime.

## Configure the Slack app

Create a Slack app from a manifest. Use separate apps if you both run locally
and deploy to Vercel so Socket Mode and the hosted webhook never share tokens.

1. In [Slack app management](https://api.slack.com/apps), choose **Create New
   App → From an app manifest** and paste one of these files:
   - For local Socket Mode: [`manifest.local.json`](./manifest.local.json).
     Slack names the app **AtlasExplorer Local**, enables Socket Mode, and
     omits Event Subscriptions / Interactivity request URLs so this app does
     not compete with the hosted webhook. If multiple developers run locally
     in the same workspace, each should create their own app, for example
     `@AtlasExplorer Local {developer-name-foo}` and
     `@AtlasExplorer Local {developer-name-bar}`.
   - For the Vercel deployment: [`manifest.json`](./manifest.json). Slack
     names the app **AtlasExplorer** and includes placeholder request URLs
     you replace after deploy.
2. Under **Basic Information → App-Level Tokens**, create a token with
   `connections:write`. This is `SLACK_APP_TOKEN` and is only used for local
   Socket Mode.
3. Install the app to the workspace and copy its **Bot User OAuth Token** as
   `SLACK_BOT_TOKEN`.
4. Copy `.env.example` to `.env` and set the Slack and Agentic target values
   for the app you just created. Set `CHAT_ALLOWED_USER_IDS` to
   comma-separated, platform-qualified IDs such as `slack:U0123456789` for
   trusted operators (copy each member ID from the Slack profile menu).

Both manifests request message/history access for DMs, public channels, and
private channels. Add the corresponding app to each channel where users will
mention it.

## Bot name

The bot has two names, set in different places. Slack never reads the bot's
config, so changing one name does not change the other.

| Name | Set in | Shown in |
| --- | --- | --- |
| Bot name | `slackBotConfig.name` in [`src/config.ts`](./src/config.ts), or the `SLACK_BOT_DISPLAY_NAME` env var | Text the bot writes, such as status lines and approval cards |
| Slack app name | `display_name` in the Slack app's manifest | The Slack sidebar and the `@` mention menu |

The bot name defaults to **AtlasExplorer**. When `SLACK_BOT_DISPLAY_NAME` is
set, it overrides `slackBotConfig.name`.

To rename the bot, change both names:

1. Set `slackBotConfig.name`, or set `SLACK_BOT_DISPLAY_NAME` for a single
   deployment.
2. Give the Slack app the same name. For an existing app, edit
   `display_name` under **App Manifest** in
   [Slack app management](https://api.slack.com/apps). For a new app, edit
   [`manifest.json`](./manifest.json) or
   [`manifest.local.json`](./manifest.local.json) before you paste it.

The local app adds ` Local` to its Slack name, as in **AtlasExplorer Local**,
so developers can tell it apart from the hosted app. That difference is only
cosmetic: the bot recognizes its mentions by Slack user ID, not by name.

## Run locally with Socket Mode

The Slack bot can run entirely on localhost; Vercel and an inbound tunnel are
not required. Socket Mode opens an outbound WebSocket to Slack.

Use the **AtlasExplorer Local** app created from `manifest.local.json`. Put
that app's bot token, signing secret, and app-level token in `.env`. Do not
point local Socket Mode at the hosted AtlasExplorer app; those credentials
belong to the Vercel webhook.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm start
```

`MONGODB_URI` is optional locally. Without it,
`mongodb-memory-server-core` starts an ephemeral MongoDB process. Chat SDK
subscriptions, locks, deduplication, queues, and Agentic workflow records all
use the same production MongoDB implementations. The embedded database stops
and its data disappears during graceful shutdown. You can then:

- DM `@AtlasExplorer Local`; each top-level DM starts a new conversation.
- Mention `@AtlasExplorer Local` in a channel; the response starts a thread.
- Send follow-ups in a thread already owned by the bot.

Channel mention routing validates the Slack user ID in the raw event. A local
app can therefore use a display name such as `AtlasExplorer Local` without a
bot named `AtlasExplorer` treating that structured mention as its own.

By default, the local bot invokes a deployed Magenta workspace. The Atlas MCP
client credentials remain configured on Magenta and never enter the Slack bot
environment.

`CHAT_ALLOWED_USER_IDS` is required in both Socket and HTTP modes. The bot
refuses to start without an explicit allowlist because every permitted user
acts through the Magenta workspace's shared Atlas identity.

### Authorize scheduled Workflow Builder messages

Slack sends a scheduled Workflow Builder message as the workflow's bot, not as
the person who created the workflow. Run the workflow once, then inspect the
bot's logs for:

```text
Rejected unauthorized actor { actorId: 'slack:B0123456789' }
```

Unauthorized bot messages are logged but do not receive a Slack denial reply,
which prevents bot-authored denial messages from triggering one another.

Add that exact `slack:B...` actor to `CHAT_ALLOWED_USER_IDS` alongside the
trusted human actors, redeploy, and run the workflow again.
Do not use the
`Wf...` workflow ID shown in Slack's workflow UI.
It is not the message author ID used by the allowlist.

Workflow security notes:
1. Only allow trusted workflows.
2. Anyone who can edit an allowed workflow can change the prompt 
   that it runs through the workspace's shared Atlas identity.
3. The workflow pattern is intended for read-only scheduled reports.
 
   A workflow bot cannot click the Approve/Reject controls required
   for persistent mutations.

### Invoke the agent locally too

To run the Slack bot and Atlas Explorer agent without deploying either one,
start Atlas Explorer in its own terminal:

```bash
cd ../../agents/atlas-explorer
agentengine dev up
```

Then configure the Slack bot:

```dotenv
AGENTIC_INVOKE_TARGET=local
AGENTIC_BASE_URL=http://localhost:3000
AGENTIC_SA_CLIENT_ID=
AGENTIC_SA_CLIENT_SECRET=
AGENTIC_PROJECT_ID=
AGENTIC_WORKSPACE_ID=
```

Start the bot with `pnpm start`. The client calls the Playground's
`/invoke/stream` proxy on port 3000, which injects the local workspace scope
before forwarding to OE. Magenta tool progress updates the transient Slack
thread status; streamed model text is collected and posted once as the durable
final response. Do not point the client directly at OE port 8000 because the
client relies on the Playground proxy to inject that scope. Atlas MCP
credentials come from the agent's local `.env`.

## Deploy to Vercel

This development bot uses the Vercel Production target only so the project
gets one stable `*.vercel.app` domain. Its Slack, Agentic, and MongoDB values
are still development credentials and data.

The current hosted development deployment is:

- Vercel project: `mongodb-team/atlas-explorer`
- Stable domain: `https://atlas-explorer-three.vercel.app`
- Slack webhook:
  `https://atlas-explorer-three.vercel.app/api/webhooks/slack`
- Function: `/api/webhooks/slack` in `iad1`, with a 300-second maximum

Set the deployment coordinates once before running the commands below:

```bash
export VERCEL_SCOPE=mongodb-team
export VERCEL_PROJECT=atlas-explorer
export VERCEL_URL=https://atlas-explorer-three.vercel.app
```

1. In the Vercel project, set the Root Directory to
   `apps/atlas-explorer-slack-bot`. Vercel installs this pnpm workspace from
   the repository root so `@repo/agent-engine-chat` resolves. Then link
   that app directory:

   ```bash
   pnpm install --frozen-lockfile
   pnpm vercel link \
     --project "$VERCEL_PROJECT" \
     --scope "$VERCEL_SCOPE"
   ```

   `vercel.json` owns the API-only framework, empty build command, Fluid
   Compute, and `iad1` region settings; `package.json` pins Node.js 22.
   Deployment Protection is a project-level setting and must not protect the
   stable webhook domain.
2. Set these Production-scoped environment variables:
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `CHAT_ALLOWED_USER_IDS` (for example, `slack:U0123456789`)
   - `AGENTIC_INVOKE_TARGET` (`gateway`)
   - `AGENTIC_SA_CLIENT_ID`
   - `AGENTIC_SA_CLIENT_SECRET`
   - `AGENTIC_PROJECT_ID`
   - `AGENTIC_WORKSPACE_ID`
   - `MONGODB_URI`
   - `AGENTIC_BASE_URL` (optional; defaults to the platform gateway)
   - `THREAD_STORE_DB` (optional; defaults to `atlas_explorer_slack`)
   - `SLACK_BOT_DISPLAY_NAME` (optional; overrides `slackBotConfig.name`)

   Enter raw values only, without surrounding shell quotes or a
   `VARIABLE_NAME=` prefix. `CHAT_ALLOWED_USER_IDS` requires qualified values
   such as `slack:U0123456789`.

   Use a project-scoped Agentic service account with the `AGENT_DEVELOPER`
   role. Vercel uses dynamic outbound IPs, so do not restrict this development
   service account to a fixed IP access list. If static Vercel egress is added
   later, restrict the account to those addresses.
3. Deploy to the Vercel production alias (`$VERCEL_URL`):

   ```bash
   pnpm deploy
   ```

   That runs `vercel deploy --prod`. Confirm the deployment is ready and that Vercel automatically advances
   `$VERCEL_URL`. Do not set a separate alias.
4. On the hosted **AtlasExplorer** app created from `manifest.json`, replace
   every `https://example.com/api/webhooks/slack` URL with the stable webhook
   URL above. Configure both Event Subscriptions and Interactivity &
   Shortcuts. Leave the **AtlasExplorer Local** app on Socket Mode.
5. Disable Socket Mode on the hosted app, save the Slack app changes, and
   reinstall only if Slack requests it or OAuth scopes changed. Slack must
   accept Event Subscriptions URL verification before testing messages.

The thin Vercel handler passes the untouched request to
`bot.webhooks.slack` and supplies Vercel's `waitUntil`, so the official adapter
can acknowledge Slack quickly while Magenta work continues. Its maximum
duration is 300 seconds. Vercel requires `MONGODB_URI`; the embedded server can
never start in production. One cached MongoDB client backs both Chat SDK state
and Agentic workflow state across warm invocations.

Completed inactive workflow mappings expire after 30 days, and an undelivered
response is retained for up to 24 hours. Records with pending reviews or
active work are excluded from expiration. Treat long-lived pending or
uncertain reviews as operational alerts: verify Agentic/Atlas state before
archiving those records.

Allow Vercel to reach the thread-store MongoDB deployment. Standard Vercel
Functions use dynamic egress addresses; this development deployment therefore
requires `0.0.0.0/0` in the thread-store Atlas project's IP Access List unless
Vercel Static IPs or Secure Compute is enabled. Database credentials still
enforce access. Atlas MCP network allowlisting is separate: MCP runs from
Magenta, so allow the Magenta runtime's egress addresses rather than Vercel's
addresses.

After cutover, test an allowlisted DM, a channel mention and thread follow-up,
a disallowed user, and both Approve and Reject review actions. Check Vercel
logs for Slack signature errors, MongoDB connection or index failures, retries,
and `FUNCTION_INVOCATION_TIMEOUT`:

```bash
pnpm vercel logs --project "$VERCEL_PROJECT" --environment production \
  --since 30m --expand --no-branch --scope "$VERCEL_SCOPE"
pnpm vercel env run -e production --scope "$VERCEL_SCOPE" -- sh -c \
  'agentengine --no-log logs --source "agent,tool" --since 30m \
  --workspace-id "$AGENTIC_WORKSPACE_ID" \
  --project-id "$AGENTIC_PROJECT_ID"'
```

Rotate the Agentic client secret before its configured expiry:

```bash
agentengine service-account rotate "$AGENTIC_SA_CLIENT_ID" \
  --project-id "$AGENTIC_PROJECT_ID" \
  --secret-expires-in 2160h
pnpm vercel env add AGENTIC_SA_CLIENT_SECRET production \
  --force --scope "$VERCEL_SCOPE"
pnpm deploy
```

Enter the newly issued secret when prompted. The previous secret remains valid
for a grace period, so verify the redeployment before that period ends. A
second rotation ends the previous secret's grace period immediately.

Useful failure signals:

- `Invalid signature` with HTTP 401 is expected for an unsigned webhook probe.
- `Invalid scheme` means `MONGODB_URI` contains a malformed stored value.
- `SSL alert 80` or `ReplicaSetNoPrimary` during startup usually means the
  thread-store Atlas IP Access List does not allow Vercel.
- HTTP 401 from `/api/v1/oauth/token` means the Agentic service-account
  credentials are invalid or its IP access list rejects Vercel.

If verification fails, inspect recent production deployments and roll back:

```bash
pnpm vercel ls "$VERCEL_PROJECT" --scope "$VERCEL_SCOPE"
pnpm vercel rollback <known-good-deployment-url> \
  --scope "$VERCEL_SCOPE"
```

Restore the prior Slack request path or Socket Mode. Keep the reusable
`manifest.json` placeholders; do not commit deployment-specific URLs or
credentials there. Leave `manifest.local.json` Socket Mode-only, with no
request URLs.

## Human review

Mutative Atlas Explorer tools suspend with an `agent_interrupt`. The bot stores
the Agentic `session_id`, execution ID, all pending interrupts, and resume
schema, then posts Approve and Reject buttons. Only the allowlisted actor who
requested the operation can decide it. The signed Chat SDK action supplies
the actor and thread identity; button values contain only the interrupt ID. New
text is blocked while review is pending.

Both buttons continue the same session by sending a `resume_map` keyed by the
pending interrupt IDs. The bot does not use the generic execution `/resume`
endpoint. An unconfirmed resume is marked uncertain and is never
automatically replayed; verify Atlas state before starting a new conversation.

## Add another chat platform

Register another Chat SDK adapter in `src/runtime.ts`, add its
platform-qualified actors to `CHAT_ALLOWED_USER_IDS`, and provide a delivery
boundary only for capabilities that are genuinely platform-specific. The
handlers under `src/chat/` already cover mentions, direct messages, subscribed
follow-ups, cards, approvals, session continuity, and delivery recovery.

Slack-specific behavior is limited to `src/platforms/slack.ts`: Agent View,
suggested prompts, App Home, Socket Mode configuration, response-size handling,
and metadata-based delivery reconciliation. Adapters without durable message
metadata use the shared conservative fallback and never assume an ambiguous
delivery failed.

## Migration compatibility

Existing records in the `slack_threads` collection are copied lazily into the
platform-neutral `chat_threads` collection on first thread activity. Session
IDs, pending reviews, requesters, recent events, and pending deliveries survive
the cutover. Keep the old collection until every active thread has either been
accessed or aged beyond its retention period.

## Development checks

```bash
pnpm test
pnpm typecheck
pnpm build
```

Tests mock external HTTP and Slack boundaries and start a test-scoped
`MongoMemoryServer`; they do not require a Slack workspace, Magenta deployment,
Docker, or separately managed MongoDB server.
