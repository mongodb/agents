# @repo/query-analysis-agent

Private library for the Query Analysis agent's behavior: policies, prompts,
and middleware.

Shared LLM selection, checkpoints, and LangGraph middleware live in
[`@repo/agent-engine-core`](../agent-engine-core).

`QUERY_ANALYSIS_MCP_TOOLS` is the subset of Atlas MCP tools this agent may
call. `ALLOW_WRITE_OPERATIONS` is ignored, and there is no
human-in-the-loop path. `aggregate` stays available. Atlas rejects `$out`
and `$merge` because the credential is read-only.
