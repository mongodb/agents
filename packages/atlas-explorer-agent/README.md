# @repo/atlas-explorer-agent

Private library for Atlas Explorer's agent behavior: the read-only tool
allowlist, prompts, and the Atlas Explorer wrappers around shared middleware.

Shared LLM selection, checkpoints, and LangGraph middleware live in
[`@repo/agent-engine-core`](../agent-engine-core). This package re-exports
that runtime so existing Atlas Explorer imports stay stable.

The deployable Atlas Agent Engine app in [`agents/atlas-explorer`](../../agents/atlas-explorer)
keeps `agent.yaml`, skills, `config.ts`, and the `App` entrypoint. It imports
this package and bundles it into `dist` so Agent Engine does not need the
workspace package at runtime.
