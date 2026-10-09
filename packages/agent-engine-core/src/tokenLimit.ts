/**
 * Copyright 2026 MongoDB, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Contract for the Atlas MCP access-token limit.
 *
 * One service account holds 100 access tokens, each for one hour. Minting
 * happens inside the process that opens the MCP session, and Agent Engine
 * runs two of those processes per execution:
 *
 * - The agent runtime lists tools at startup (`registerMcpTools`), which
 *   opens a session and mints a token for that process.
 * - The tool runtime does the same at its own startup, and opens a new
 *   session again for each tool call.
 *
 * The caches are per process, so a token minted in one runtime is invisible
 * to the other. Each runtime therefore has its own handler.
 */

export const MCP_ACCESS_TOKEN_LIMIT = 100;
export const MCP_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

export const TOKEN_EXHAUSTION_SIGNATURES = [
  "did not become ready during startup",
  "access token limit",
] as const;

const MAX_CAUSE_DEPTH = 3;

export type McpTokenRuntime = "agent" | "tool";

/**
 * Startup failed because this process could not mint an MCP access token.
 * `runtime` says which process. Clients match this error, or the signatures
 * above, to tell the user the hourly limit is reached.
 */
export class McpTokenLimitError extends Error {
  readonly runtime: McpTokenRuntime;

  constructor(runtime: McpTokenRuntime, cause: unknown) {
    super(
      `${runtime} runtime did not become ready during startup: shared Atlas access token limit reached`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "McpTokenLimitError";
    this.runtime = runtime;
  }
}

export function isTokenExhaustionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    const message = messageOf(current).toLowerCase();
    if (
      TOKEN_EXHAUSTION_SIGNATURES.some((signature) =>
        message.includes(signature),
      )
    ) {
      return true;
    }
    const cause = causeOf(current);
    if (cause === undefined) {
      return false;
    }
    current = cause;
  }
  return false;
}

/**
 * Agent runtime. The only mint this process performs is listing tools while
 * it starts. A failure there aborts startup with {@link McpTokenLimitError}.
 * Any other error is rethrown unchanged.
 */
export function handleAgentRuntimeTokenLimit(error: unknown): never {
  throw tokenLimitOrOriginal("agent", error);
}

/**
 * Tool runtime startup. This process mints its own token while listing
 * tools, separate from the agent runtime's token. A failure aborts this
 * process's startup with {@link McpTokenLimitError}.
 */
export function handleToolRuntimeTokenLimit(error: unknown): never {
  throw tokenLimitOrOriginal("tool", error);
}

/**
 * Tool runtime, during a tool call. The tool process opens a new MCP session
 * for the call, so this is a second mint on top of startup. The agent graph
 * is where that failure arrives: tell the model to stop, because every Atlas
 * tool in this process shares the exhausted budget.
 *
 * Returns undefined when the error is not the token limit, so the caller can
 * keep its normal tool-error behavior.
 */
export function handleToolCallTokenLimit(
  toolName: string,
  error: unknown,
): string | undefined {
  if (!isTokenExhaustionError(error)) {
    return undefined;
  }
  return (
    `Tool "${toolName}" could not run because the tool runtime hit the ` +
    `shared Atlas access token limit for this hour. Retrying, or calling ` +
    `any other Atlas tool, will fail the same way. Do not call more tools. ` +
    `Tell the user that the assistant has reached its hourly access limit ` +
    `and ask them to try again in about an hour.`
  );
}

export interface TokenMintStartup {
  ready(): Promise<void>;
}

/**
 * Runs the process's startup handler around `ready()`, which is where Agent
 * Engine discovers MCP tools and mints this process's token. Agent and tool
 * processes both load the agent entrypoint, so the handler follows
 * `RUNNER_MODE`.
 */
export function guardTokenMintStartup(app: TokenMintStartup): void {
  const ready = app.ready.bind(app);
  app.ready = async () => {
    try {
      await ready();
    } catch (error) {
      if (tokenMintRuntime() === "tool") {
        handleToolRuntimeTokenLimit(error);
      }
      handleAgentRuntimeTokenLimit(error);
    }
  };
}

function tokenMintRuntime(): McpTokenRuntime {
  const mode = process.env["RUNNER_MODE"];
  return mode === "tool" || mode === "tool_function" ? "tool" : "agent";
}

function tokenLimitOrOriginal(
  runtime: McpTokenRuntime,
  error: unknown,
): unknown {
  return isTokenExhaustionError(error)
    ? new McpTokenLimitError(runtime, error)
    : error;
}

function messageOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    return typeof value.message === "string" ? value.message : "";
  }
  return "";
}

function causeOf(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "cause" in value) {
    return value.cause;
  }
  return undefined;
}
