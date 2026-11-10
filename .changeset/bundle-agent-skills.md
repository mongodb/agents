---
"@mongodb-js/agent-engine-core": patch
"@mongodb-js/atlas-explorer-agent": patch
"@mongodb-js/atlas-query-insights-agent": patch
---

Bundle each agent's MongoDB skills inside `@mongodb-js/atlas-explorer-agent` and `@mongodb-js/atlas-query-insights-agent`, and add `<agent-pkg> sync-skills` CLI commands backed by `@mongodb-js/agent-engine-core` to copy them into `./skills` during `build`.
