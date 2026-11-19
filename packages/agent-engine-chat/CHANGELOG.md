# @mongodb-js/agent-engine-chat

## 0.1.4

### Patch Changes

- f8f542c: Add `registerSlackChatHandlers` to `@mongodb-js/agent-engine-chat/slack` to
  wire Slack delivery, review interrupt parsing, and optional App Home handling
  in one call, and derive the Agent Engine `client` label in
  `registerChatHandlers` from `adapter.name`.

## 0.1.3

### Patch Changes

- 4d6dd6c: Add the `@mongodb-js/agent-engine-chat/slack` subpath export with reusable
  Slack adapter creation, durable markdown delivery, response splitting, review
  interrupt parsing, and App Home registration helpers.

## 0.1.2

No changes in this release.

## 0.1.1

No changes in this release.
