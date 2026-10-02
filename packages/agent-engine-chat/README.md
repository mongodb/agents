# @repo/agent-engine-chat

Private library that connects a [Chat SDK](https://chat-sdk.dev) app to any
Atlas Agent Engine agent. The Atlas Explorer Slack bot in
[`apps/atlas-explorer-slack-bot`](../../apps/atlas-explorer-slack-bot) is its
consumer.

## What's in it

Each export is a separate subpath of the package.

- **`/chat`.** `registerChatHandlers` wires mentions, direct messages,
  thread follow-ups, and Approve/Reject review cards to an agent.
- **`/agent-engine`.** `AgentEngineClient` invokes and resumes an agent,
  with streaming, and handles service-account tokens.
- **`/store`.** Thread and Chat SDK state storage in MongoDB, plus an in-memory
  thread store.
- **`/testing`.** Fakes for tests that use the handlers.

## Wiring

```ts
import { createSlackAdapter } from "@chat-adapter/slack";
import { Chat } from "chat";

import { registerChatHandlers } from "@repo/agent-engine-chat/chat";
import { AgentEngineClient } from "@repo/agent-engine-chat/agent-engine";
import { MongoStateAdapter, MongoThreadStore } from "@repo/agent-engine-chat/store";

const uri = process.env.MONGODB_URI!;
const databaseName = "my_agent_chat";

const bot = new Chat({
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      mode: "webhook",
      userName: "My Agent",
    }),
  },
  state: new MongoStateAdapter({ uri, databaseName }),
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
  store: await MongoThreadStore.connect(uri, databaseName),
});

export const POST = (request: Request) => bot.webhooks.slack(request);
```

The Slack bot's [`runtime.ts`](../../apps/atlas-explorer-slack-bot/src/runtime.ts)
shows the full version, with an allowlist and custom messages.
