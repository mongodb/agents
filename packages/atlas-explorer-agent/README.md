# @mongodb-js/atlas-explorer-agent

Library for Atlas Explorer's agent behavior. The deployable app lives
in [`agents/atlas-explorer`](../../agents/atlas-explorer).

## Install

```bash
npm install @mongodb-js/atlas-explorer-agent langchain @langchain/core @langchain/langgraph zod \
  @mongodb-js/agent-engine-sdk @mongodb-js/agent-engine-runner-shared \
  @mongodb-js/mcp-tools-assistant
```

`langchain` is a peer dependency. The others are peers of
`@mongodb-js/agent-engine-core`, which installs with this package.

This package is at `0.x`. Its API is unstable and can change in any release.

## What's in it

- **Tool policy.** The read-only Atlas MCP allowlist, which tools are exposed,
  and which tools need approval. Writes stay off unless
  `ALLOW_WRITE_OPERATIONS` is set to something other than empty or `false`.
  Database-user creation and access-list changes stay hidden in both modes
  (`HIGH_RISK_MCP_TOOLS`). Other tools the Atlas MCP server adds later are
  still exposed when writes are on.
- **System prompts.** Read-only and write-enabled prompts, with an optional
  agent name and custom instructions.
- **Shared runtime.** Re-exports from
  [`@mongodb-js/agent-engine-core`](../agent-engine-core): LLM selection, agent
  input, requester metadata, resume handling, and LangGraph middleware.

## Build and test

From the repository root, with Node.js 24 or newer:

```bash
pnpm install
pnpm --filter @mongodb-js/atlas-explorer-agent build
pnpm --filter @mongodb-js/atlas-explorer-agent test
```

`build` and `test` build `@mongodb-js/agent-engine-core` first. `typecheck`
type-checks sources and tests without emitting files. `test:watch` runs the
tests in watch mode.
