# @repo/atlas-explorer-agent

Private library for Atlas Explorer's agent behavior. The deployable app lives
in [`agents/atlas-explorer`](../../agents/atlas-explorer).

## What's in it

- **Tool policy.** The read-only Atlas MCP allowlist, which tools are exposed,
  and which tools need approval. Writes stay off unless
  `ALLOW_WRITE_OPERATIONS` is set to something other than empty or `false`.
- **System prompts.** Read-only and write-enabled prompts, with an optional
  agent name and custom instructions.
- **Shared runtime.** Re-exports from
  [`@repo/agent-engine-core`](../agent-engine-core): LLM selection, agent
  input, requester metadata, resume handling, and LangGraph middleware.

## Install, build, and test

From the repository root, with Node.js 24 or newer:

```bash
pnpm install
pnpm --filter @repo/atlas-explorer-agent build
pnpm --filter @repo/atlas-explorer-agent test
```

`build` and `test` build `@repo/agent-engine-core` first. `typecheck`
type-checks sources and tests without emitting files. `test:watch` runs the
tests in watch mode.
