# @repo/query-analysis-agent

Private library for the Query Analysis agent's behavior: policies, prompts,
and middleware.

Shared LLM selection, checkpoints, and LangGraph middleware live in
[`@repo/agent-engine-core`](../agent-engine-core).

`QUERY_ANALYSIS_MCP_TOOLS` is the subset of Atlas MCP tools this agent may
call. `ALLOW_WRITE_OPERATIONS` is ignored, and there is no
human-in-the-loop path. `aggregate` stays available. Atlas rejects `$out`
and `$merge` because the credential is read-only.

`buildSystemPrompt` adapts the Query Insights assistant rules to an
agent. It takes `{ name, customInstructions, scope, maxQueryShapes }`,
points at the evidence block, and tells the agent which Performance
Advisor branch to apply for each shape.

`annotatePerformanceAdvisorMiddleware` appends an evidence block to
`mongodb__atlas_get_performance_advisor` results: slow logs grouped by
namespace and query shape, formatted ratios, collection-scan and sort
signals, and the matching suggested index. A result that cannot be
parsed is returned unchanged.

`displayQueryStat` renders counts, bytes, durations, and ratios the way
Query Insights does, including `N/A` for invalid values. The
conformance vector is the same file the server formatter is pinned to.

`resolveScope` reads an optional `{ projectId, clusterName }` pin.
`scopeGuardMiddleware` turns a tool call aimed at a different project or
cluster into a recoverable tool error. `describeScope` is the sentence the
system prompt quotes.
