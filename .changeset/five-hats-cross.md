---
"@mongodb-js/agent-engine-chat": patch
---

Add `registerSlackChatHandlers` to `@mongodb-js/agent-engine-chat/slack` to
wire Slack delivery, review interrupt parsing, and optional App Home handling
in one call, and derive the Agent Engine `client` label in
`registerChatHandlers` from `adapter.name`.
