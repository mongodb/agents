# Bug: Tool Pod skill roots depend on import order

## Summary

**Status: confirmed locally in `0.1.87-alpha`; Atlas Explorer has a temporary
build-time mitigation.**

Deep-agent skills were discoverable in the bundle but unreadable at runtime,
failing with `ENOENT`, unless `AGENTIC_AGENT_WORKDIR` was set before importing
the Magenta TypeScript modules.

The Tool Pod filesystem implementation snapshots its allowed skill roots at
module load. A normal static import runs before application initialization can
set the work directory, so setting the environment variable afterward is too
late. Atlas Explorer initially had to replace the static Magenta import with a
dynamic import ordered after the environment assignment. A later attempt to
restore the static import reproduced the failure in both a focused regression
test and a fresh `agentic dev up` stack.

This hidden import-order contract creates fragile behavior across local
execution, bundles, test runners, and deployed entrypoints.

## Environment

- Agentic CLI: `0.1.87-alpha` (`aa2aeae42`)
- Runner image: `runner-base-typescript-langgraph:0.1.87-alpha`
- Playground UI: `playground-ui:0.1.87-alpha`
- Orchestration engine: `0.0.76`
- LangChain: `1.5.10`
- Deep Agents: `1.13.2`
- Magenta TypeScript Tool Pod backend
- Local Docker development stack on macOS

## Reproduction

1. Start a Node process without `AGENTIC_AGENT_CONFIG_PATH` or
   `AGENTIC_AGENT_WORKDIR`.
2. Import `filesystemRead` from `@magenta/runner-shared-ts`.
3. Set `AGENTIC_AGENT_WORKDIR` to a temporary agent root containing
   `skills/example.md`.
4. Call `filesystemRead()` with the absolute path to that file.
5. Observe that the path is rebased into the session workspace and returns
   `ENOENT`.
6. Apply the proposed lazy initialization and repeat the same process.
7. Observe that the same file is read successfully.
8. Repeat through a fresh `agentic dev up` stack and the Tool Pod
   `filesystem_read` endpoint.

## Actual behavior

Skill readability depends on whether the environment variable exists at the
instant the Magenta module is evaluated. Files added correctly to the bundle
can still appear missing because the allowed roots were computed from an
earlier or incorrect working directory.

The focused reproduction returned:

```text
ENOENT: no such file or directory, stat
'/private/tmp/agent-workspace/.../magenta-agent-root-.../skills/example.md'
```

The local Tool Pod returned HTTP 200 for the tool envelope, but the tool result
contained:

```text
ENOENT: no such file or directory, stat
'/tmp/agent-workspace/.sessions/.../app/skills/mongodb-mcp-setup/SKILL.md'
```

The local container received `AGENT_ENTRYPOINT` but neither
`AGENTIC_AGENT_CONFIG_PATH` nor `AGENTIC_AGENT_WORKDIR`, so the early
runner-shared import cached an empty read-only root list.

## Expected behavior

Skill roots should be supplied explicitly by the runner/backend or resolved
when the backend handles a request. Correctly bundled skills should not depend
on JavaScript module evaluation order, and startup should fail clearly if the
configured root is missing or unreadable.

## Evidence

- A deterministic child-process regression test imports runner-shared before
  setting the work directory. The unmodified SDK fails; lazy initialization
  passes.
- A fresh `agentic dev up` stack reproduced the same failure through the actual
  Tool Pod endpoint.
- The requested `SKILL.md` existed at `/app/skills/...`, and Tool Pod tool
  discovery succeeded, ruling out a missing bundle or failed server startup.
- After changing only root initialization from module-load time to first
  filesystem access, the same Tool Pod request returned `HTTP 200` with the
  expected skill content.
- An end-to-end request through the playground `/invoke` route then returned
  the skill heading successfully.
- Cloud image generation sets
  `AGENTIC_AGENT_CONFIG_PATH=/app/agent.yaml`, while the generated local dev
  container did not provide either supported root variable. This makes behavior
  inconsistent across otherwise equivalent runtimes.

## Root cause

The filesystem/skill root is derived from mutable process environment during
module initialization and cached in module-level state. ECMAScript static
imports are evaluated before the importing module's body, which prevents that
body from establishing the required variable in time.

The runner does not guarantee the environment variable before user-module
evaluation, and the backend does not validate or lazily recompute the root.
The application therefore has to know and satisfy an undocumented temporal
coupling.

## Impact

- Bundled skills fail at runtime despite passing package/content tests.
- Refactoring a dynamic import back to a static import silently regresses
  behavior.
- Test and production loaders can differ based on module cache and import
  order.
- Error messages report `ENOENT`, directing investigation toward packaging
  rather than root initialization.
- Any other module that imports Magenta first can freeze the wrong roots before
  the application workaround runs.

## Suggested fix

The smallest SDK-owned fix is to resolve and cache the roots on first
filesystem access rather than at module evaluation:

```typescript
let readonlyResourceRoots: readonly string[] | undefined;

function getReadonlyResourceRoots(): readonly string[] {
  return (readonlyResourceRoots ??= [
    readonlySkillsRootFromEnv(),
  ].filter((root): root is string => root !== null));
}

function isWithinReadonlyResourceRoot(resolved: string): boolean {
  return getReadonlyResourceRoots().some((root) =>
    isWithinRoot(resolved, root),
  );
}
```

Other platform-owned solutions are:

1. Have the runner set `AGENTIC_AGENT_WORKDIR` before loading any user or
   Magenta module.
2. Pass the agent/skills root explicitly to `MagentaToolPodBackend`.

In all cases, add startup validation that checks the resolved root and expected
skills directory, then reports the resolved nonsecret path and remediation.
Avoid module-level snapshots of mutable environment where possible.

## Acceptance criteria

- Static and dynamic import forms resolve the same skill root when the
  application establishes the root before its first filesystem operation.
- A correctly bundled `SKILL.md` is readable without application-specific
  import choreography.
- `agentic dev up` and cloud deployments establish equivalent root behavior.
- The runner establishes the work directory before user-module evaluation, or
  the backend accepts it explicitly.
- Missing or unreadable roots fail at startup with an actionable error rather
  than a later generic `ENOENT`.
- Tests cover unset, preset, invalid, relative, and deployed work directories.
- Module cache/import order does not change the allowed roots.
- Filesystem access remains constrained to approved roots.

## Workaround

Atlas Explorer temporarily runs `scripts/patch-runner-shared.mjs` before its
build, test, start, and development scripts. The script changes the installed
runner-shared JavaScript from eager root initialization to the lazy
implementation above. It is idempotent and fails the build if the pinned SDK
changes in a way that makes the expected patch target unrecognizable.

This workaround is needed at build time because Agentic local and cloud builds
install platform-provided SDK tarballs, overriding ordinary package-manager
dependency patches. It should be deleted once the runner contains the fix.

Without that temporary patch, set `AGENTIC_AGENT_WORKDIR` before any Magenta
import and use a dynamic import. Ensure no earlier dependency imports the
Magenta module first.
