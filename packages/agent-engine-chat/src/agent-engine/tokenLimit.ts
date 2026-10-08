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
 * Recognizes failures caused by the Atlas MCP access token limit.
 *
 * This module has no imports on purpose. It is exposed as the
 * `@repo/agent-engine-chat/token-limit` subpath so chat clients and the agent
 * runtime can share one definition without pulling in the HTTP client or
 * MongoDB.
 *
 * The Atlas MCP server allows each service account 100 active access tokens
 * for 1 hour each. When they are used up, Agent Engine cannot start a new
 * agent process, and the invocation fails with the first message below; the
 * runtime logs the second.
 */
export const TOKEN_EXHAUSTION_SIGNATURES = [
  "did not become ready during startup",
  "access token limit",
] as const;

const MAX_CAUSE_DEPTH = 3;

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
    if (typeof current !== "object" || current === null) {
      return false;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function messageOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const message = (value as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}
