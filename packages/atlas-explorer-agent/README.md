# @repo/atlas-explorer-agent

Private library for Atlas Explorer's agent behavior: tool policy, prompts,
LLM selection, and LangGraph middleware.

The deployable Magenta app in [`apps/atlas-explorer`](../../apps/atlas-explorer)
keeps `agent.yaml`, skills, `config.ts`, and the `App` entrypoint. It imports
this package and bundles it into `dist` so Agent Engine does not need the
workspace package at runtime.
