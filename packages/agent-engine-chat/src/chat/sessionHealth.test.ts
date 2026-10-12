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

import { describe, expect, it } from "vitest";

import {
  assertValidSessionLimit,
  evaluateSessionHealth,
  SESSION_WINDOW_MS,
  sessionWindowStart,
  startsAgentSession,
} from "./sessionHealth.js";

const NOW = new Date("2026-09-08T13:00:00.000Z");
const MINUTE = 60_000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

describe("assertValidSessionLimit", () => {
  it("accepts a positive integer limit and a positive idle TTL", () => {
    expect(() =>
      assertValidSessionLimit({ limit: 1, idleTtlMs: 10 * MINUTE }),
    ).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a limit of %s",
    (limit) => {
      expect(() =>
        assertValidSessionLimit({ limit, idleTtlMs: 10 * MINUTE }),
      ).toThrow("sessionLimit.limit must be a positive integer");
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an idle TTL of %s",
    (idleTtlMs) => {
      expect(() =>
        assertValidSessionLimit({ limit: 1, idleTtlMs }),
      ).toThrow("sessionLimit.idleTtlMs must be a positive number");
    },
  );
});

describe("startsAgentSession", () => {
  const idleTtlMs = 10 * MINUTE;

  it("starts a session for a thread the agent has not run in", () => {
    expect(startsAgentSession(null, NOW, idleTtlMs)).toBe(true);
    expect(startsAgentSession(undefined, NOW, idleTtlMs)).toBe(true);
    expect(
      startsAgentSession({ updatedAt: minutesAgo(1) }, NOW, idleTtlMs),
    ).toBe(true);
  });

  it("reuses the live sandbox for a follow-up inside the idle TTL", () => {
    expect(
      startsAgentSession(
        { agentSessionId: "session-1", updatedAt: minutesAgo(9) },
        NOW,
        idleTtlMs,
      ),
    ).toBe(false);
  });

  it("starts a session once the idle TTL has elapsed", () => {
    expect(
      startsAgentSession(
        { agentSessionId: "session-1", updatedAt: minutesAgo(10) },
        NOW,
        idleTtlMs,
      ),
    ).toBe(true);
    expect(
      startsAgentSession(
        { agentSessionId: "session-1", updatedAt: minutesAgo(45) },
        NOW,
        idleTtlMs,
      ),
    ).toBe(true);
  });
});

describe("sessionWindowStart", () => {
  it("looks back one token lifetime", () => {
    expect(NOW.getTime() - sessionWindowStart(NOW).getTime()).toBe(
      SESSION_WINDOW_MS,
    );
    expect(SESSION_WINDOW_MS).toBe(60 * MINUTE);
  });
});

describe("evaluateSessionHealth", () => {
  it("is available while other active sessions are under the limit", () => {
    expect(
      evaluateSessionHealth([minutesAgo(30), minutesAgo(5)], NOW, 3),
    ).toEqual({ kind: "available" });
    expect(evaluateSessionHealth([], NOW, 1)).toEqual({
      kind: "available",
    });
  });

  it("reports when the oldest blocking activity leaves the window", () => {
    expect(
      evaluateSessionHealth(
        [minutesAgo(50), minutesAgo(20), minutesAgo(5)],
        NOW,
        3,
      ),
    ).toEqual({ kind: "limit_reached", retryAfterMs: 10 * MINUTE });
  });

  it("waits for enough activity to age out when well over the limit", () => {
    // Five others active with a limit of 3: three must age out before the
    // count drops to 2, so the third-oldest entry sets the wait.
    expect(
      evaluateSessionHealth(
        [
          minutesAgo(55),
          minutesAgo(40),
          minutesAgo(30),
          minutesAgo(20),
          minutesAgo(5),
        ],
        NOW,
        3,
      ),
    ).toEqual({ kind: "limit_reached", retryAfterMs: 30 * MINUTE });
  });

  it("handles a limit of one", () => {
    expect(evaluateSessionHealth([minutesAgo(59)], NOW, 1)).toEqual({
      kind: "limit_reached",
      retryAfterMs: MINUTE,
    });
  });

  it("ignores activity outside the window and unsorted input", () => {
    expect(
      evaluateSessionHealth(
        [minutesAgo(5), minutesAgo(90), minutesAgo(50)],
        NOW,
        2,
      ),
    ).toEqual({ kind: "limit_reached", retryAfterMs: 10 * MINUTE });
    expect(
      evaluateSessionHealth([minutesAgo(90), minutesAgo(61)], NOW, 1),
    ).toEqual({ kind: "available" });
  });
});
