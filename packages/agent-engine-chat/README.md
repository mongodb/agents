# @repo/agent-engine-chat

Private library that connects a [Chat SDK](https://chat-sdk.dev) app to any
Atlas Agent Engine agent. It owns:

- `chat` — conversation flow, review cards, and Chat SDK handlers
- `magenta` — Agent Engine invoke/resume client and service-account tokens
- `store` — in-memory and MongoDB thread/state adapters

Deployed Slack wiring for Atlas Explorer stays in
[`apps/atlas-explorer-slack-bot`](../../apps/atlas-explorer-slack-bot). That
app passes Atlas Explorer card copy and database defaults into this library.
Review buttons use this package's action IDs,
`agent_engine_chat_review_approve` and `agent_engine_chat_review_reject`.

```ts
import { registerChatHandlers } from "@repo/agent-engine-chat/chat";
import { MagentaClient } from "@repo/agent-engine-chat/magenta";
import { MongoThreadStore } from "@repo/agent-engine-chat/store";
```
