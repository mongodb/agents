# Bug: Magenta and LangGraph JS drop run metadata from checkpoints

## Summary

**Status: confirmed by source inspection in the pinned Magenta release and in
the pinned LangGraph JS release.**

A TypeScript Magenta agent has no supported way to attach application metadata
to a LangGraph checkpoint. Magenta never populates `config.metadata`, offers no
hook that can, and LangGraph JS discards `config.metadata` on the
invoke/stream path even when it is set.

This is a gap in an otherwise complete feature. LangGraph's Mongo checkpointer
already persists checkpoint metadata a second time as plain BSON under
`metadata_search` specifically so it can be queried, and `CheckpointMetadata`
is generically typed to carry caller-defined properties. The storage and query
halves exist; only the write path is missing.

LangGraph Python does not have this gap: its savers merge `config["metadata"]`
into checkpoint metadata before persisting. The TypeScript runtime is the
outlier.

## Environment

- Atlas Explorer Magenta dependencies:
  `8780ea124e6be996ef7b96885f14588195b98d96`
- Package: `@magenta/magenta-sdklanggraph-ts`
- `@langchain/langgraph`: `1.4.13`
- `@langchain/langgraph-checkpoint`: `1.1.5`
- `@langchain/langgraph-checkpoint-mongodb`: `1.4.1`
- Native (non-durable) session against a MongoDB-backed checkpointer

## Reproduction

1. Build a TypeScript Magenta agent that compiles a graph with
   `app.checkpointer()`.
2. Attempt to attach an application-defined key to checkpoint metadata by any
   supported means — `app.prepareAgentInput`, `app.resolveThreadId`, or a
   `metadata` field on the run config.
3. Invoke the agent and let it write checkpoints.
4. Read the resulting documents from the `checkpoints` collection.
5. Observe that `metadata_search` contains only `source`, `step`, and
   `parents`. The application key is absent from every checkpoint.

## Actual behavior

There is no reachable path from application code to checkpoint metadata.

Magenta builds the run config itself, and that config has no `metadata` field:

```ts
const config: RunnableConfig = {
  configurable: {
    thread_id: this.threadId,
    request_context: this.ctx,
  },
};
```

Neither tenant hook can change this. `PrepareAgentInput` returns the graph
input and `ResolveThreadId` returns a thread id; neither receives or returns a
`RunnableConfig`.

Even if `config.metadata` were set, LangGraph JS would discard it. The Pregel
loop rebuilds checkpoint metadata from scratch on every checkpoint, keeping
only the three engine-owned fields:

```ts
this.checkpointMetadata = {
  ...inputMetadata,
  step: this.step,
  parents: this.config.configurable?.[CONFIG_KEY_CHECKPOINT_MAP] ?? {},
};
```

`inputMetadata` is always an engine literal — `{ source: "loop" }`,
`{ source: "input" }`, or `{ source: "fork" }`. `config.metadata` is merged
into checkpoint metadata only in `bulkUpdateState`, which backs `updateState`
and never runs during a normal invoke or stream.

## Expected behavior

An application should be able to attach JSON-safe metadata to a run and have
it persist on that run's checkpoints, reachable through the query API
LangGraph already provides:

```ts
for await (const tuple of saver.list(config, {
  filter: { "requester.actor_id": "slack:U123" },
})) {
  // ...
}
```

Two independent fixes would each close the gap:

- LangGraph JS merges `config.metadata` into checkpoint metadata on the
  invoke/stream path, matching the Python runtime.
- Magenta exposes a tenant hook that contributes metadata to the run config it
  builds, the way `prepareAgentInput` contributes graph input.

## Evidence

Magenta, pinned source:

- `baseConfig()` [builds a config with no `metadata` field](https://github.com/10gen/magenta-client-libraries/blob/8780ea124e6be996ef7b96885f14588195b98d96/packages/magenta-sdklanggraph-ts/src/execution_session.ts#L133-L144)
- `PrepareAgentInput` and `ResolveThreadId` [cannot reach the config](https://github.com/10gen/magenta-client-libraries/blob/8780ea124e6be996ef7b96885f14588195b98d96/packages/magenta-sdklanggraph-ts/src/execution_session.ts#L20-L25)
- `checkpointer()` [constructs the Mongo saver internally](https://github.com/10gen/magenta-client-libraries/blob/8780ea124e6be996ef7b96885f14588195b98d96/packages/magenta-sdklanggraph-ts/src/runtime.ts#L844-L850)

LangGraph JS, pinned to `@langchain/langgraph@1.4.13`:

- `_putCheckpoint()` [rebuilds metadata and drops caller keys](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/pregel/loop.ts#L1790-L1794)
- `bulkUpdateState()` [is the only place `config.metadata` is merged](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/pregel/index.ts#L1267)
- `CheckpointMetadata` [is typed to carry extra properties](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/checkpoint/src/types.ts#L17-L63)

The storage and query halves that this gap strands:

- `put()` [writes `metadata_search` as plain BSON](https://github.com/langchain-ai/langgraphjs/blob/2b8cc2f3fd5c9d3c33b56e013292daf5d936428e/libs/checkpoint-mongodb/src/checkpoint.ts#L402-L407)
- `list()` [queries `metadata_search.<key>`](https://github.com/langchain-ai/langgraphjs/blob/2b8cc2f3fd5c9d3c33b56e013292daf5d936428e/libs/checkpoint-mongodb/src/checkpoint.ts#L289)

LangGraph Python, for contrast:

- `get_checkpoint_metadata()` [merges `config["metadata"]` into checkpoint metadata](https://github.com/langchain-ai/langgraph/blob/eae02c622d2e346b88fe22ba466be838d7de34bb/libs/checkpoint/langgraph/checkpoint/base/__init__.py#L746-L764)

Note that the Python merge copies only `str`, `int`, `bool`, and `float`
values. A nested object is dropped, so Python parity alone would not carry a
structured subdocument.

## Root cause

LangGraph JS treats checkpoint metadata as engine-owned bookkeeping on the
invoke path. The loop owns `source`, `step`, and `parents`, and rewrites the
whole object each superstep rather than merging into it, so any caller
contribution would be overwritten at the next step even if it were seeded.

Magenta compounds this by owning config construction end to end. The SDK
supplies `thread_id` and `request_context` and exposes hooks only for graph
input and thread id, so a tenant cannot reach the config at all.

Neither layer is individually unreasonable; the gap is that they compose into
having no supported write path to a field the storage layer already indexes
and the query API already reads.

## Impact

- Per-run application context cannot be persisted anywhere queryable. For
  Atlas Explorer this means Slack requester identity is recoverable only by
  decoding the serialized checkpoint blob.
- `metadata_search` and the `list({ filter })` API are effectively limited to
  the three engine fields, so a documented query surface goes mostly unused.
- Applications must patch the saver instance to close the gap, which couples
  them to checkpointer internals the SDK otherwise encapsulates.
- TypeScript and Python Magenta agents behave differently for the same code
  shape, which is surprising when porting an agent between runtimes.

## Suggested fix

1. In LangGraph JS, merge `config.metadata` into checkpoint metadata on the
   invoke/stream path, mirroring Python's `get_checkpoint_metadata`, with the
   engine fields (`source`, `step`, `parents`) always winning.
2. Decide deliberately whether the JS merge preserves nested JSON-safe objects
   rather than inheriting Python's scalar-only restriction. Nested values are
   what make `metadata_search` useful for structured context.
3. In Magenta, add a tenant hook that contributes run metadata to the config
   built in `baseConfig()`, alongside the existing `prepareAgentInput` and
   `resolveThreadId` hooks.
4. Reserve and document the platform-owned metadata keys so a tenant cannot
   overwrite engine or platform bookkeeping.
5. Keep the Python and TypeScript runtimes aligned on whichever semantics are
   chosen.

## Acceptance criteria

- A JSON-safe value supplied by an application appears under `metadata_search`
  on every checkpoint written by that run.
- Engine-owned `source`, `step`, and `parents` always win over caller keys.
- `saver.list(config, { filter })` matches on an application-supplied key.
- Metadata round-trips through `getTuple()` without corrupting the
  `CheckpointMetadata` shape LangGraph expects.
- Resume and human-in-the-loop runs carry the metadata supplied on the
  resuming request, not a stale copy from the original invocation.
- Behavior is documented and consistent across the Python and TypeScript SDKs.
