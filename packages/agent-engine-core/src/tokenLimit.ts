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
 *
 * Tokens come from `POST https://cloud.mongodb.com/api/oauth/token`, which
 * can refuse a mint in two ways:
 *
 * - `token_limit`: 403 `access_denied`, `error_description` "Access Token
 *   limit reached. Please use the existing Access Tokens or create a new
 *   Service Account". Clears as the oldest tokens expire, up to an hour.
 * - `token_rate_limit`: 429 with the non-OAuth body
 *   `{"status":"ERROR","errorCode":"RATE_LIMITED"}`, at 50 requests per
 *   minute for each IP and client ID. Clears within a minute.
 *
 * The runner rethrows MCP auth failures as `MCPConfigError` or
 * `MCPToolError` carrying only the message, so the HTTP status and OAuth
 * error code are lost. The MCP SDK writes `HTTP 429` into the message only
 * when the body is not an OAuth error, which is why the 429 is recognizable
 * and the 403 is matched by its description.
 */

export const MCP_ACCESS_TOKEN_LIMIT = 100;
export const MCP_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

export const ACCESS_TOKEN_LIMIT_MESSAGE = "Access Token limit reached";
export const TOKEN_RATE_LIMIT_STATUS = "HTTP 429";
export const TOKEN_RATE_LIMIT_ERROR_CODE = "RATE_LIMITED";

const MAX_CAUSE_DEPTH = 3;

export type McpTokenRuntime = "agent" | "tool";
export type McpTokenFailure = "token_limit" | "token_rate_limit";

/**
 * Startup failed because this process could not mint an MCP access token.
 * `runtime` says which process and `failure` says which limit refused it.
 */
export class McpTokenLimitError extends Error {
  readonly runtime: McpTokenRuntime;
  readonly failure: McpTokenFailure;

  constructor(
    runtime: McpTokenRuntime,
    failure: McpTokenFailure,
    cause: unknown,
  ) {
    super(
      `${runtime} runtime could not mint an Atlas MCP access token: ${FAILURE_REASONS[failure]}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "McpTokenLimitError";
    this.runtime = runtime;
    this.failure = failure;
  }
}

const FAILURE_REASONS: Record<McpTokenFailure, string> = {
  token_limit: "the service account has reached its access token limit",
  token_rate_limit: "the token endpoint rate limit is reached",
};

const RETRY_HINTS: Record<McpTokenFailure, string> = {
  token_limit: "has reached its hourly access limit and ask them to try again in about an hour",
  token_rate_limit: "is briefly rate limited and ask them to try again in about a minute",
};

/**
 * Returns which token mint limit the error reports, checking the error and
 * its `cause` chain, or undefined for any other failure.
 */
export function classifyTokenMintError(
  error: unknown,
): McpTokenFailure | undefined {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    const failure = classifyMessage(messageOf(current));
    if (failure !== undefined) {
      return failure;
    }
    const cause = causeOf(current);
    if (cause === undefined) {
      return undefined;
    }
    current = cause;
  }
  return undefined;
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
  const failure = classifyTokenMintError(error);
  if (failure === undefined) {
    return undefined;
  }
  return (
    `Tool "${toolName}" could not run because the tool runtime could not ` +
    `mint an Atlas access token: ${FAILURE_REASONS[failure]}. Retrying, or ` +
    `calling any other Atlas tool, will fail the same way. Do not call more ` +
    `tools. Tell the user that the assistant ${RETRY_HINTS[failure]}.`
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
  const failure = classifyTokenMintError(error);
  return failure === undefined
    ? error
    : new McpTokenLimitError(runtime, failure, error);
}

function classifyMessage(message: string): McpTokenFailure | undefined {
  if (message.includes(ACCESS_TOKEN_LIMIT_MESSAGE)) {
    return "token_limit";
  }
  if (
    message.includes(TOKEN_RATE_LIMIT_STATUS) &&
    message.includes(TOKEN_RATE_LIMIT_ERROR_CODE)
  ) {
    return "token_rate_limit";
  }
  return undefined;
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
