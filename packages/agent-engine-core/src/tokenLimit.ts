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

import { getLogger } from "@mongodb-js/agent-engine-runner-shared";

/**
 * Contract for the Atlas MCP access-token limit.
 *
 * One service account holds 100 access tokens, each for one hour. Agent
 * Engine runs two processes per execution, the agent runtime and the tool
 * runtime, and each mints its own token while listing MCP tools at startup
 * (`registerMcpTools`, inside `ready()`). Later MCP sessions in that process,
 * including tool calls, reuse the cached token until it expires.
 *
 * The caches are per process, so a token minted in one runtime is invisible
 * to the other. Each runtime therefore has its own startup handler.
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
 * Why the errors are matched by message text: by the time startup fails,
 * only the message string is left. The runner wraps the failure in an
 * `MCPConfigError` that keeps the message but drops the HTTP status and the
 * OAuth error code, so we can't check for 403 or 429 directly.
 *
 * What each message contains depends on the response body:
 * - The 403 body is a valid OAuth error, so the MCP SDK uses its
 *   `error_description` as the message. We match that text, "Access Token
 *   limit reached".
 * - The 429 body is not a valid OAuth error, so the SDK builds a message
 *   from the status and the raw body: `HTTP 429: Invalid OAuth error
 *   response: ... Raw body: {"status":"ERROR","errorCode":"RATE_LIMITED"}`.
 *   We match `HTTP 429` together with `RATE_LIMITED`.
 */

export const MCP_ACCESS_TOKEN_LIMIT = 100;
export const MCP_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

export const ACCESS_TOKEN_LIMIT_MESSAGE = "Access Token limit reached";
export const TOKEN_RATE_LIMIT_STATUS = "HTTP 429";
export const TOKEN_RATE_LIMIT_ERROR_CODE = "RATE_LIMITED";

const logger = getLogger("agent-engine-core.tokenLimit");

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
 * Throws for a failed agent runtime startup. If `error` is a token mint
 * refusal, throws {@link McpTokenLimitError} labelled "agent" with `error`
 * as its cause. Otherwise throws `error` unchanged.
 */
export function throwAgentRuntimeTokenLimit(error: unknown): never {
  throw tokenLimitOrOriginal("agent", error);
}

/**
 * Throws for a failed tool runtime startup. The tool process lists MCP
 * tools and mints its own token at startup, separate from the agent
 * runtime's token, so it can be refused too. If `error` is a token mint
 * refusal, throws {@link McpTokenLimitError} labelled "tool" with `error` as
 * its cause. Otherwise throws `error` unchanged.
 */
export function throwToolRuntimeTokenLimit(error: unknown): never {
  throw tokenLimitOrOriginal("tool", error);
}

export interface TokenMintStartup {
  ready(): Promise<void>;
}

/**
 * Replaces `app.ready()` with a wrapper that rewrites token mint failures
 * into {@link McpTokenLimitError}. `ready()` is where Agent Engine discovers
 * MCP tools and mints this process's token.
 *
 * The wrapper calls the original `ready()` right away, because the SDK has
 * already started discovery in its constructor and a refusal can arrive
 * before the runtime asks for `ready()`. If it rejects with a token limit
 * or token rate limit refusal, the wrapper logs an ERROR line and rejects
 * with {@link McpTokenLimitError}, with the original error as `cause`. The
 * error names the runtime, taken from `RUNNER_MODE` because agent and tool
 * processes load the same entrypoint, and the limit that refused the mint.
 * Any other rejection is passed on unchanged and not logged here.
 *
 * It does not recover: startup still fails. The only effects are the log
 * line and the clearer error that the runner then reports. Call it once,
 * before `app.run()`.
 */
export function surfaceTokenMintFailures(app: TokenMintStartup): void {
  const started = app.ready().catch((error: unknown) => {
    try {
      if (tokenMintRuntime() === "tool") {
        throwToolRuntimeTokenLimit(error);
      }
      throwAgentRuntimeTokenLimit(error);
    } catch (surfaced) {
      if (surfaced instanceof McpTokenLimitError) {
        logger.error(
          {
            err: surfaced,
            runtime: surfaced.runtime,
            failure: surfaced.failure,
          },
          `${surfaced.message}. Startup cannot continue.`,
        );
      }
      throw surfaced;
    }
  });
  // Mark handled so a refusal before the runtime awaits ready() is not
  // reported as an unhandled rejection. Callers still see the rejection.
  started.catch(() => undefined);
  app.ready = () => started;
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
