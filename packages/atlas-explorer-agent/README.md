# @repo/atlas-explorer-agent

Private library for Atlas Explorer's agent behavior: the read-only tool
allowlist, system prompts, and the Atlas Explorer wrappers around shared
middleware.

Shared LLM selection, checkpoints, and LangGraph middleware live in
[`@repo/agent-engine-core`](../agent-engine-core). This package re-exports
that runtime so existing Atlas Explorer imports stay stable.

The deployable Atlas Agent Engine app in [`agents/atlas-explorer`](../../agents/atlas-explorer)
keeps `agent.yaml`, skills, `config.ts`, and the `App` entrypoint. It imports
this package and bundles it into `dist` so Agent Engine does not need the
workspace package at runtime. See [How the app consumes it](#how-the-app-consumes-it).

## Exports

The package has a single entry point, `@repo/atlas-explorer-agent`
([`src/index.ts`](src/index.ts)). Everything below is a named export of it.

### Tool policy (defined here)

Source: [`src/agentPolicy.ts`](src/agentPolicy.ts).

| Export | Purpose |
| --- | --- |
| `READ_ONLY_MCP_TOOLS` | Set of the Atlas Managed MCP tool names Atlas Explorer may call without write access. |
| `selectAtlasTools(tools, allowWriteOperations?)` | Keeps the read-only tools, or every tool when write operations are enabled. |
| `mutativeInterruptOn(tools)` | Builds the `interruptOn` map for `humanInTheLoopMiddleware`: every tool outside `READ_ONLY_MCP_TOOLS` requires approval. |
| `writeOperationsAllowed(env?)` | `true` when `ALLOW_WRITE_OPERATIONS` is set to anything other than empty or `false`. |

### System prompts (defined here)

Source: [`src/systemMessage.ts`](src/systemMessage.ts).

| Export | Purpose |
| --- | --- |
| `buildSystemPrompt(writeEnabled, options?)` | Returns the read-only or write-enabled prompt. `options.name` replaces the default "Atlas Explorer" name, and `options.customInstructions` is appended under a "Custom instructions" heading. |
| `READ_ONLY_SYSTEM_PROMPT` | The read-only prompt with the default name. |
| `WRITE_ENABLED_SYSTEM_PROMPT` | The write-enabled prompt with the default name. |
| `SystemPromptOptions` | Type of the `options` argument. |

### Re-exported from `@repo/agent-engine-core`

These are implemented in [`packages/agent-engine-core`](../agent-engine-core/src).

| Concern | Exports |
| --- | --- |
| LLM selection | `buildLLM`, `resolveOpenAIResponsesApi`, `BuildLLMOptions` |
| Agent input | `prepareAtlasExplorerInput` (the core `prepareAgentInput` under the Atlas Explorer name) |
| Client user identity | `clientUserSchema`, `parseClientUserPayload`, `stampClientUser`, `ClientUser`, `ClientUserExtras` |
| Requester metadata | `withRequesterMetadata`, `requesterFromCheckpoint`, `Requester` |
| Resume handling | `isAgentEngineResume`, `stampResumeClientUserMiddleware`, `stampResumeMessages` |
| Model output | `stripToolEchoMiddleware` |
| Tool errors | `recoverToolErrorsMiddleware`, `recoverToolCall`, `formatToolErrorForAgent` |
| Backend | `withoutShellExecution` |

## LLM providers

`buildLLM(options)` returns a LangChain chat model for one of four providers:
`anthropic`, `cerebras`, `gemini`, or `openai`.

```ts
import { buildLLM } from "@repo/atlas-explorer-agent";

const llm = buildLLM({
  provider: "anthropic", // optional
  model: "claude-sonnet-4-5", // optional, falls back to a provider default
  temperature: 0, // optional
  logPrefix: "atlas-explorer", // optional log tag, defaults to "agent"
});
```

- With `provider` set, `buildLLM` uses that provider and throws if its API
  key is missing or the provider is not one of the four above.
- With `provider` unset, it uses the first provider whose API key is set,
  checking Gemini, then OpenAI, then Anthropic, then Cerebras. It throws if
  none is set.
- API keys come from `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  and `CEREBRAS_API_KEY`.
- Default models when `model` is unset: `gemini-2.5-flash` (Gemini),
  `gpt-4o-mini` (OpenAI), `claude-sonnet-4-5` (Anthropic), and
  `qwen-3-235b-a22b-instruct-2507` (Cerebras).
- Optional `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `AZURE_OPENAI_API_VERSION`,
  and `OPENAI_USE_RESPONSES_API` (`auto`, `true`, or `false`) adjust the OpenAI
  and Anthropic clients. See
  [`llm.ts`](../agent-engine-core/src/llm.ts) for the exact behavior.

## Scripts

Run from the repository root with `pnpm --filter @repo/atlas-explorer-agent <script>`.

| Script | What it does |
| --- | --- |
| `build` | Compiles `src` to `dist` with `tsc -p tsconfig.json`. |
| `test` | Runs the unit tests once with Vitest. |
| `test:watch` | Runs Vitest in watch mode. |
| `typecheck` | Type-checks `src` and the test files without emitting output. |

`build`, `test`, `test:watch`, and `typecheck` each have a `pre*` hook that
first builds `@repo/agent-engine-core`, so the package works from a clean
checkout.

## Build before consuming

The package's `exports` map points at `dist/index.js` and `dist/index.d.ts`,
and `@repo/agent-engine-core` is consumed the same way from its own `dist`.
Nothing resolves to `src`, so a consumer needs a built package.

```bash
pnpm install
pnpm --filter @repo/atlas-explorer-agent build
```

Building this package also builds `@repo/agent-engine-core` first. The
`atlas-explorer` app does the same through its own `prebuild`, `pretest`,
`pretypecheck`, and `predev` hooks, so you rarely need to run this by hand.
If you run a tool that skips those hooks, such as `npx vitest` or `tsc` in the
app directory, build the package first or the import of
`@repo/atlas-explorer-agent` fails to resolve.

## How the app consumes it

[`agents/atlas-explorer`](../../agents/atlas-explorer) lists this package as
`"@repo/atlas-explorer-agent": "workspace:*"` and imports it from `main.ts`.
Its `build` script runs `esbuild --bundle` with `@langchain/*`,
`@mongodb-js/*`, `langchain`, `zod`, and `dotenv` marked external. This
package and `@repo/agent-engine-core` are not external, so esbuild inlines them
into `dist/agent_atlas_explorer/main.js`.

The external packages are still imported at runtime. Some of them, such as
`zod` and the `@langchain/{anthropic,cerebras,google-genai,openai}` provider
SDKs, are declared by `@repo/agent-engine-core`, not by the app's
`package.json`. In this workspace they are not installed in the app's own
`node_modules`, so running `node dist/agent_atlas_explorer/main.js` from the app
directory fails with `ERR_MODULE_NOT_FOUND` for `zod`. Declare them in the app
before relying on the bundle outside Agent Engine's own runtime.

See the [app README](../../agents/atlas-explorer/README.md) for configuration,
local development, and deployment.
