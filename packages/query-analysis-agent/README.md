# @repo/query-analysis-agent

Private library for the Query Analysis agent's tool policy.

The allowlist is read-only. `ALLOW_WRITE_OPERATIONS` is ignored, and there is
no human-in-the-loop path. `aggregate` stays available; `$out` and `$merge`
are rejected by the read-only Atlas credential rather than by this package.

Shared runtime lives in [`@repo/agent-engine-core`](../agent-engine-core).
