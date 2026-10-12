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

import type { ThreadRecord } from "../store/threadStore.js";

/**
 * Atlas MCP access tokens last one hour, so session activity is measured over
 * the same window.
 */
export const SESSION_WINDOW_MS = 60 * 60 * 1_000;

export interface SessionLimit {
  /** Idle time after which a thread's agent sandbox is gone and a follow-up starts a new one. */
  idleTtlMs: number;
  /** Most agent sessions allowed within the rolling hour, counting the one about to start. */
  limit: number;
}

/**
 * Throws when `sessionLimit` can't be enforced, so bad config fails at
 * startup instead of producing nonsense refusals.
 */
export function assertValidSessionLimit(
  sessionLimit: SessionLimit,
): void {
  const { idleTtlMs, limit } = sessionLimit;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `sessionLimit.limit must be a positive integer, got ${limit}`,
    );
  }
  if (!Number.isFinite(idleTtlMs) || idleTtlMs <= 0) {
    throw new Error(
      `sessionLimit.idleTtlMs must be a positive number, got ${idleTtlMs}`,
    );
  }
}

export type SessionHealth =
  | { kind: "available" }
  | { kind: "limit_reached"; retryAfterMs: number };

/**
 * Whether handling a message will start an agent session, which mints Atlas
 * access tokens. That is true for a thread the agent has never run in, and for
 * a follow-up that arrives after the idle TTL has retired the sandbox. A
 * follow-up inside the idle TTL reuses the live sandbox and mints nothing.
 *
 * `previous` must be the thread record as it was before this turn was claimed,
 * because claiming a turn overwrites `updatedAt`.
 */
export function startsAgentSession(
  previous: Pick<ThreadRecord, "agentSessionId" | "updatedAt"> | null | undefined,
  now: Date,
  idleTtlMs: number,
): boolean {
  if (!previous?.agentSessionId) {
    return true;
  }
  return now.getTime() - previous.updatedAt.getTime() >= idleTtlMs;
}

export function sessionWindowStart(now: Date): Date {
  return new Date(now.getTime() - SESSION_WINDOW_MS);
}

/**
 * Decides whether another agent session may start, given the `updatedAt` of
 * every other thread that was recently active.
 *
 * When the limit is reached, `retryAfterMs` is how long until enough of that
 * activity ages out of the window to free one slot. It assumes the busy
 * threads stay quiet, so it is an estimate.
 */
export function evaluateSessionHealth(
  activity: readonly Date[],
  now: Date,
  limit: number,
): SessionHealth {
  const windowStart = sessionWindowStart(now).getTime();
  const inWindow = activity
    .map((updatedAt) => updatedAt.getTime())
    .filter((updatedAt) => updatedAt >= windowStart)
    .sort((left, right) => left - right);
  if (inWindow.length < limit) {
    return { kind: "available" };
  }
  // Dropping the oldest (length - limit + 1) entries brings the count under
  // the limit; the last of those is the one that matters.
  const blockingActivity = inWindow[inWindow.length - limit]!;
  return {
    kind: "limit_reached",
    retryAfterMs: Math.max(
      0,
      blockingActivity + SESSION_WINDOW_MS - now.getTime(),
    ),
  };
}
