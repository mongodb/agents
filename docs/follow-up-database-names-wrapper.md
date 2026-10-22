# Nest `databaseNames` under a `dataAccess` wrapper

Follow-up to EAI-2440 (PR #177).

## Summary

EAI-2440 adds `databaseNames` as a top-level field, next to `dataAccess`
in each agent's `config.ts`. This ticket moves it into `dataAccess` so
that all Atlas access rules live in one place.

## Background

- `dataAccess` is typed as an index signature keyed by 24-hex project ID.
  `validateDataAccess`, `describeDataAccess`, and `clusterAllowlist` all
  treat every key as a project.
- A `databaseNames` key inside `dataAccess` would fail project ID
  validation at startup. Any wrapper has to change the shape.
- `databaseNames` applies to every allowed cluster, not per project, so it
  should not sit inside the project map.

## Proposed config

```ts
dataAccess: {
  projects: {
    "<24-hex project id>": { clusterNames: ["a"] },
  },
  databaseNames: ["orders", /^tenant_\d+$/],
},
```

## Scope

- Change the `DataAccessConfig` type and its validation in
  `packages/agent-engine-core/src/dataAccess.ts`.
- Update `clusterAllowlist.ts`, `databaseNames` wiring in both agents'
  `main.ts`, and `describeDataAccess` to read `dataAccess.projects`.
- Remove the top-level `databaseNames` from `AtlasExplorerConfig` and
  `AtlasQueryInsightsConfig` in `agentConfig.ts`.
- Update both agents' `config.ts`, both READMEs, and the deploy skill.
- Update tests that build `dataAccess` directly.

## Open questions

- Is `dataAccess: {}` still unrestricted? Proposal: yes, when both
  `projects` and `databaseNames` are omitted.
- Do we accept the old top-level `databaseNames` for one release, or make
  the change breaking? Any deployer who sets it in this PR would need to
  move it.

## Consolidate shared config types

`AtlasExplorerConfig` and `AtlasQueryInsightsConfig` in `agentConfig.ts`
repeat the same blocks: `llm`, `systemPrompt`, `dataAccess`,
`databaseNames`, and `inputGuard`. Move the shared parts into one place
in `agent-engine-core`, such as `LlmConfig` and `SystemPromptConfig`, and
have each agent's root type compose them. `InputGuardConfig` already lives
in core, so it is the pattern to follow.

## Acceptance criteria

- A config with `dataAccess.databaseNames` restricts database tools the same
  way the current top-level field does.
- A project ID key still fails validation when malformed.
- Typecheck and unit tests pass in both agents and the shared packages.
