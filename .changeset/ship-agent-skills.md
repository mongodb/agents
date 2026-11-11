---
"@mongodb-js/agent-engine-core": patch
"@mongodb-js/atlas-explorer-agent": patch
"@mongodb-js/atlas-query-insights-agent": patch
---

Ship each agent's MongoDB skills in its package, with a `sync-skills` command that copies them into `./skills` during your build.
