# @repo/agent-engine-chat

Private library that connects a [Chat SDK](https://chat-sdk.dev) app to any
Atlas Agent Engine agent. It owns:

- `chat` — conversation flow, review cards, and Chat SDK handlers
- `agent-engine` — Agent Engine invoke/resume client and service-account tokens
- `store` — in-memory and MongoDB thread/state adapters

Deployed Slack wiring for Atlas Explorer stays in
[`apps/atlas-explorer-slack-bot`](../../apps/atlas-explorer-slack-bot). That
app passes Atlas Explorer card copy and database defaults into this library.

## Exports

Each subpath resolves to compiled output in `dist`. There is no root (`.`)
export.

| Subpath | Contents |
| --- | --- |
| `@repo/agent-engine-chat/chat` | `registerChatHandlers` and `ChatHandlerOptions`; `buildReviewCard`, `REVIEW_APPROVE_ACTION_ID`, `REVIEW_REJECT_ACTION_ID`; `defaultAgentChatMessages`, `resolveAgentChatMessages`, `AgentChatMessages`; identity helpers `SLACK_CHAT_CLIENT`, `clientUserFromAuthor`, `platformActorId`; and the types `AgentGateway`, `ConversationSurface`, `DeliveryBoundary`, `DeliveryStatus`, `HandlerLogger`, `ChatHandlerDependencies`. |
| `@repo/agent-engine-chat/agent-engine` | `AgentEngineClient` (invoke, resume, and their streaming variants), `AgenticApiError`, `AgenticAuthenticationError`, `ServiceAccountTokenProvider`, the `AgentEngineClientConfig` type, and the invocation request/response schemas and types. |
| `@repo/agent-engine-chat/store` | `MongoThreadStore`, `MemoryThreadStore`, `MongoStateAdapter` and `createMongoState`, the MongoDB connection helpers `createMongoConnection`, `getSharedMongoConnection`, and `closeSharedMongoConnection`, and the `ThreadStore` and `ThreadRecord` types. |
| `@repo/agent-engine-chat/testing` | Test doubles for consumers' tests: `FakeAgentGateway`, `FakeConversation`, the `completed` and `suspended` fixtures, `callingTool`, `seedPendingReview`, and `slackAdaClientUser`. Import it from tests only. |

The authoritative lists are the `index.ts` files in
[`src/chat`](src/chat/index.ts), [`src/agent-engine`](src/agent-engine/index.ts),
and [`src/store`](src/store/index.ts), plus the `exports` map in
[`package.json`](package.json).

Review buttons use the action IDs `agent_engine_chat_review_approve` and
`agent_engine_chat_review_reject`.

## Build before consuming

Because the `exports` map points at `dist`, a consumer cannot import this
package until it has been built:

```bash
pnpm install
pnpm --filter @repo/agent-engine-chat build
```

[`apps/atlas-explorer-slack-bot`](../../apps/atlas-explorer-slack-bot) runs this
build from its own `pre*` hooks, and its `vercel.json` uses the same command as
the Vercel build command. This package's own `test` script does not need a
build, because its tests import `src`.

## Wiring example

A complete webhook route for a Slack bot. It is the same composition that
[`runtime.ts`](../../apps/atlas-explorer-slack-bot/src/runtime.ts) in the
Atlas Explorer Slack bot performs. Install `chat` and `@chat-adapter/slack` in
the consuming app.

```ts
import { createSlackAdapter } from "@chat-adapter/slack";
import { Chat } from "chat";

import { registerChatHandlers } from "@repo/agent-engine-chat/chat";
import { AgentEngineClient } from "@repo/agent-engine-chat/agent-engine";
import {
  getSharedMongoConnection,
  MongoStateAdapter,
  MongoThreadStore,
} from "@repo/agent-engine-chat/store";

const databaseName = "my_agent_chat";

const connection = await getSharedMongoConnection({
  databaseName,
  uri: process.env.MONGODB_URI,
});

const slack = createSlackAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  mode: "webhook",
  userName: "My Agent",
});

const store = MongoThreadStore.fromDatabase(connection.database);
await store.initialize();

const bot = new Chat({
  adapters: { slack },
  state: new MongoStateAdapter({ client: connection.client, databaseName }),
  userName: "My Agent",
});

registerChatHandlers(bot, {
  agent: new AgentEngineClient({
    baseUrl: "https://agentic-platform.mongodb.com",
    invokeTarget: "gateway",
    projectId: process.env.AGENTIC_PROJECT_ID!,
    workspaceId: process.env.AGENTIC_WORKSPACE_ID!,
    serviceAccount: {
      clientId: process.env.AGENTIC_SA_CLIENT_ID!,
      clientSecret: process.env.AGENTIC_SA_CLIENT_SECRET!,
    },
  }),
  botName: "My Agent",
  store,
});

export async function POST(request: Request): Promise<Response> {
  return bot.webhooks.slack(request);
}
```

On a serverless host such as Vercel, pass `{ waitUntil }` as the second
argument to `bot.webhooks.slack` so work continues after the response.

Notes on the options:

- `agent` is any `AgentGateway`. `AgentEngineClient` is the HTTP
  implementation. For a locally running agent, use
  `{ baseUrl: "http://localhost:3000", invokeTarget: "local" }` instead of the
  gateway fields.
- `authorizedActorIds` is an optional set of `platform:userId` strings, for
  example `slack:U123`. When set, only those users can start a thread
  subscription, send messages that reach the agent, or approve and reject
  reviews. Anyone else gets a "not authorized" reply.
- `messages` overrides any of the user-facing strings in
  `AgentChatMessages`. Atlas Explorer's overrides are in
  [`atlasExplorerChat.ts`](../../apps/atlas-explorer-slack-bot/src/atlasExplorerChat.ts).
- `deliveryForAdapter` and `reviewInterruptIdForAdapter` let a platform
  supply its own delivery-marker and review-button handling. The Slack bot
  app implements both in
  [`platforms/slack.ts`](../../apps/atlas-explorer-slack-bot/src/platforms/slack.ts).
- Slack mention filtering (`slackMentions.ts`) is applied inside
  `registerChatHandlers`, so consumers do not call it.

## Thread store and MongoDB collections

`MongoThreadStore` keeps one `ThreadRecord` per Chat SDK thread ID in the
`chat_threads` collection of the database you pass to `fromDatabase`.
`initialize()` creates three indexes:

- `chat_thread_unique`, a unique index on `threadId`
- `inactive_thread_ttl`, which expires records with `retentionState:
  "inactive"` 30 days after `updatedAt`
- `pending_delivery_ttl`, which expires records with `retentionState:
  "delivery_pending"` 24 hours after `updatedAt`

A record holds the Agent Engine session in `agentSessionId`, the
event IDs already handled (for de-duplication), the in-flight turn lease, any
pending human review (interrupt, requested actions, and who requested them), and
any reply waiting to be delivered. The store's methods claim a turn, a review,
or a delivery with a lease so concurrent serverless invocations do not handle
the same event twice.

`MongoStateAdapter` is the separate Chat SDK state adapter (subscriptions,
locks, cache, and queues). It uses one collection, `chat_sdk_state` by default,
and the database name `agent_engine_chat` unless you pass `databaseName`.

`MemoryThreadStore` implements the same `ThreadStore` interface in process
memory, with a 24 hour TTL and a 1,000 record cap by default. Use it for tests
and local runs only.

### Lazy migration from `slack_threads`

Earlier versions of the Slack bot stored one document per Slack thread in a
`slack_threads` collection, keyed by `<channelId>:<threadTs>`.
`MongoThreadStore.fromDatabase` passes that collection as the legacy
source, and migrates each thread the first time it is read or claimed:

1. Only thread IDs of the form `slack:<channelId>:<threadTs>` are considered.
   If a `chat_threads` record already exists, it is used as is, and any
   matching legacy document is marked complete.
2. Otherwise the legacy document is marked `chatSdkMigrationState: "copying"`,
   translated, and inserted into `chat_threads`. Slack-only fields become
   platform-neutral ones: `recentSlackEventIds` becomes `recentEventIds` and
   `pendingRequestedBySlackUserId` becomes `pendingRequestedByActorId`, both
   with a `slack:` prefix added when missing. `channelId` and `threadTs` are
   dropped.
3. The legacy document is then marked `chatSdkMigrationState: "complete"` with
   `chatSdkMigratedAt` and `chatSdkThreadId`. It is not deleted.

Records written before the session field was renamed to `agentSessionId`
keep the old field name, which is no longer read. A thread with such a record
starts a new Agent Engine session on its next message, and a review that was
pending on it can no longer be approved or rejected. There is no data
migration for this field.

`MongoStateAdapter` also reads `slack_threads` (override the name with
`legacyThreadCollectionName`) so that threads subscribed before the migration
stay subscribed and recent Slack event IDs are still de-duplicated for 24
hours.

## Scripts

Run from the repository root with `pnpm --filter @repo/agent-engine-chat <script>`.

| Script | What it does |
| --- | --- |
| `build` | Compiles `src` to `dist` with `tsc -p tsconfig.json`. |
| `test` | Runs the unit tests once with Vitest. They use an in-memory MongoDB (`mongodb-memory-server-core`), which is downloaded on first run. |
| `test:watch` | Runs Vitest in watch mode. |
| `typecheck` | Type-checks `src` and the test files without emitting output. |
