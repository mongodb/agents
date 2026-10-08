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

import type { TurnResult } from "../load/turnResult.js";
import { oct7Ndjson } from "../logs/fixtures/oct7Fixture.js";
import {
  parseRuntimeDiagLogs,
  type DiagEvent,
} from "../logs/parseRuntimeDiag.js";
import { buildReport, type RunMeta } from "./buildReport.js";
import { renderMarkdown } from "./renderMarkdown.js";

const meta: RunMeta = {
  runId: "oct7",
  workspace: "atlas-explorer",
  since: "2026-10-07T16:55:00.000Z",
  until: "2026-10-07T17:30:00.000Z",
  orchestrationEngineImage:
    "867958226915.dkr.ecr.us-east-1.amazonaws.com/agentic-platform/orchestration-engine-go:v0.11.7",
  engineImageObservedAt: "2026-10-08T15:00:00.000Z",
};

function at(iso: string): string {
  return iso;
}

describe("buildReport", () => {
  it("reproduces the Oct 7 pre-fix churn", () => {
    const report = buildReport({
      meta,
      events: parseRuntimeDiagLogs(oct7Ndjson),
    });
    const session = report.sessions[0];

    expect(session).toMatchObject({
      sessionId: "diag-test-1791392694",
      sameAgentSandbox: false,
    });
    expect(session?.turns).toMatchObject([
      {
        turn: 1,
        agentInstanceId: "578a2da3",
        firstExecutionOnInstance: true,
        executionId: "4ce1c874-55bd-4eb0-a15c-7f7a6b21eaf5",
        gapSincePreviousTurnMs: null,
        newAgentProcessStartsAfter: 0,
        newToolProcessStartsAfter: 0,
      },
      {
        turn: 2,
        agentInstanceId: "488fe528",
        firstExecutionOnInstance: true,
        executionId: "33475f48-69fd-4208-98b6-cae48814d908",
        newAgentProcessStartsAfter: 2,
        newToolProcessStartsAfter: 1,
      },
    ]);
    expect(session?.turns[1]?.gapSincePreviousTurnMs).toBe(31_893);
    expect(report.tokens).toMatchObject({
      observedCount: 3,
      estimatedMints: 3,
      peakActiveTokens: 6,
    });
    expect(report.tokens.observedFingerprints).toEqual([
      "2f0dc1d102ec",
      "597eb3a25b28",
      "c71e07bb5962",
    ]);
    expect(report.processStarts).toEqual({ aer: 2, tool: 1 });
    expect(report.firstExecutionShare).toEqual({
      executions: 2,
      firstExecutions: 2,
    });
    expect(report.failures.firstTokenLimitErrorAt).toBeNull();
  });

  it("stops counting process starts at the next session's turn", () => {
    const events: DiagEvent[] = [
      execution("aaaa", 1, "first", "e1", "2026-10-08T12:00:00.000Z"),
      execution("bbbb", 1, "first", "e2", "2026-10-08T12:00:30.000Z"),
      processStart("cccc", "aer", "2026-10-08T12:00:40.000Z"),
      execution("dddd", 1, "second", "e3", "2026-10-08T12:01:00.000Z"),
      processStart("eeee", "tool", "2026-10-08T12:01:10.000Z"),
    ];
    const report = buildReport({
      meta: {
        ...meta,
        since: "2026-10-08T12:00:00.000Z",
        until: "2026-10-08T13:00:00.000Z",
      },
      events,
    });
    const first = report.sessions.find((session) => session.sessionId === "first");
    const second = report.sessions.find(
      (session) => session.sessionId === "second",
    );

    expect(first?.turns[1]).toMatchObject({
      newAgentProcessStartsAfter: 1,
      newToolProcessStartsAfter: 0,
    });
    expect(second?.turns[0]).toMatchObject({
      newAgentProcessStartsAfter: 0,
      newToolProcessStartsAfter: 1,
    });
  });

  it("reports sandbox reuse when both turns stay on one agent", () => {
    const events: DiagEvent[] = [
      {
        kind: "process_start",
        timestamp: at("2026-10-08T12:00:00.000Z"),
        instanceId: "aaaaaaaa",
        mode: "aer",
        service: "agent",
        pid: 1,
        host: "fctr",
        tokenCaches: { mongodb: "absent" },
      },
      {
        kind: "mcp_token_cached",
        timestamp: at("2026-10-08T12:00:01.000Z"),
        instanceId: "aaaaaaaa",
        mode: "aer",
        service: "agent",
        server: "mongodb",
        n: 1,
        fingerprint: "aaaaaaaabbbb",
        expiry: at("2026-10-08T13:00:00.000Z"),
        cacheUpdatedAt: at("2026-10-08T12:00:00.000Z"),
        uptimeSeconds: 1,
      },
      execution("aaaaaaaa", 1, "sess", "exec-1", "2026-10-08T12:01:00.000Z"),
      execution("aaaaaaaa", 2, "sess", "exec-2", "2026-10-08T12:01:30.000Z"),
    ];
    const report = buildReport({
      meta: {
        ...meta,
        since: "2026-10-08T12:00:00.000Z",
        until: "2026-10-08T12:10:00.000Z",
      },
      events,
    });

    expect(report.sessions[0]).toMatchObject({
      sessionId: "sess",
      sameAgentSandbox: true,
    });
    expect(report.sessions[0]?.turns).toMatchObject([
      { firstExecutionOnInstance: true, newAgentProcessStartsAfter: 0 },
      { firstExecutionOnInstance: false, newAgentProcessStartsAfter: 0 },
    ]);
    expect(report.tokens).toMatchObject({
      observedCount: 1,
      estimatedMints: 1,
      peakActiveTokens: 1,
    });
  });

  it("counts overlapping tokens and does not double-count a logged mint", () => {
    const events: DiagEvent[] = [
      processStart("aaaa", "aer", "2026-10-08T10:00:00.000Z"),
      token("aaaa", "finger-one", "2026-10-08T10:00:00.000Z", "2026-10-08T11:00:00.000Z"),
      token("bbbb", "finger-two", "2026-10-08T10:30:00.000Z", "2026-10-08T11:30:00.000Z"),
      processStart("cccc", "tool", "2026-10-08T10:45:00.000Z"),
    ];
    const report = buildReport({
      meta: {
        ...meta,
        since: "2026-10-08T10:00:00.000Z",
        until: "2026-10-08T12:00:00.000Z",
      },
      events,
    });

    expect(report.tokens).toEqual({
      observedCount: 2,
      observedFingerprints: ["finger-one", "finger-two"],
      estimatedMints: 2,
      peakActiveTokens: 3,
    });
  });

  it("measures recovery after a token-limit failure", () => {
    const turns: TurnResult[] = [
      turn("s1", 1, "completed", "2026-10-08T12:00:00.000Z"),
      turn("s2", 1, "error", "2026-10-08T12:05:00.000Z", "2026-10-08T12:05:01.000Z"),
      turn("s3", 1, "completed", "2026-10-08T13:15:00.000Z"),
    ];
    const events: DiagEvent[] = [
      execution("aaaa", 1, "sess-1", "exec-1", "2026-10-08T12:00:01.000Z"),
      {
        kind: "token_limit_error",
        timestamp: "2026-10-08T12:05:00.000Z",
        service: "agent",
        message: "Access Token limit reached",
      },
      execution("bbbb", 1, "sess-3", "exec-3", "2026-10-08T13:15:02.000Z"),
    ];
    const report = buildReport({
      meta: {
        ...meta,
        since: "2026-10-08T12:00:00.000Z",
        until: "2026-10-08T14:00:00.000Z",
      },
      events,
      turns,
    });

    expect(report.failures).toEqual({
      firstTokenLimitErrorAt: "2026-10-08T12:05:00.000Z",
      firstClientErrorAt: "2026-10-08T12:05:01.000Z",
      firstSuccessAfterFailureAt: "2026-10-08T13:15:00.000Z",
      recoveryMs: 70 * 60 * 1000,
    });
    expect(report.sessions.map((session) => session.sessionLabel)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    expect(report.otherSessions).toEqual([]);
  });

  it("does not count a failed turn's execution line as recovery", () => {
    const turns: TurnResult[] = [
      turn("s1", 1, "completed", "2026-10-08T12:00:00.000Z"),
      turn("s2", 1, "error", "2026-10-08T12:05:00.000Z", "2026-10-08T12:05:01.000Z"),
      turn("s3", 1, "error", "2026-10-08T12:10:00.000Z", "2026-10-08T12:10:01.000Z"),
    ];
    const events: DiagEvent[] = [
      execution("aaaa", 1, "sess-1", "exec-1", "2026-10-08T12:00:01.000Z"),
      {
        kind: "token_limit_error",
        timestamp: "2026-10-08T12:05:00.000Z",
        service: "agent",
        message: "Access Token limit reached",
      },
      // prepareAgentInput logs this before the turn runs, so it is not proof of success.
      execution("bbbb", 1, "sess-3", "exec-3", "2026-10-08T12:10:00.500Z"),
    ];
    const report = buildReport({
      meta: {
        ...meta,
        since: "2026-10-08T12:00:00.000Z",
        until: "2026-10-08T14:00:00.000Z",
      },
      events,
      turns,
    });

    expect(report.failures).toMatchObject({
      firstSuccessAfterFailureAt: null,
      recoveryMs: null,
    });
  });

  it("falls back to execution lines for recovery when there are no client turns", () => {
    const events: DiagEvent[] = [
      {
        kind: "token_limit_error",
        timestamp: "2026-10-08T12:05:00.000Z",
        service: "agent",
        message: "Access Token limit reached",
      },
      execution("bbbb", 1, "sess-3", "exec-3", "2026-10-08T13:15:00.000Z"),
    ];
    const report = buildReport({
      meta: {
        ...meta,
        since: "2026-10-08T12:00:00.000Z",
        until: "2026-10-08T14:00:00.000Z",
      },
      events,
    });

    expect(report.failures.recoveryMs).toBe(70 * 60 * 1000);
  });

  it("reads the fetched log window when one is recorded", () => {
    const events: DiagEvent[] = [
      // After the load ends at 12:30, inside the 2-minute log padding.
      processStart("aaaa", "aer", "2026-10-08T12:31:00.000Z"),
    ];
    const loadWindow = {
      ...meta,
      since: "2026-10-08T12:00:00.000Z",
      until: "2026-10-08T12:30:00.000Z",
    };

    expect(buildReport({ meta: loadWindow, events }).processStarts).toEqual({
      aer: 0,
      tool: 0,
    });

    const fetched = {
      ...loadWindow,
      logWindow: { since: "2026-10-08T12:00:00.000Z", until: "2026-10-08T12:32:00.000Z" },
    };
    const report = buildReport({ meta: fetched, events });
    expect(report.processStarts).toEqual({ aer: 1, tool: 0 });
    expect(renderMarkdown(report)).toContain(
      "- Window: 2026-10-08T12:00:00.000Z to 2026-10-08T12:32:00.000Z",
    );
  });
});

describe("renderMarkdown", () => {
  it("includes the engine image, the churn, and both token counts", () => {
    const markdown = renderMarkdown(
      buildReport({
        meta,
        events: parseRuntimeDiagLogs(oct7Ndjson),
      }),
    );

    expect(markdown).toContain("orchestration-engine-go:v0.11.7");
    expect(markdown).toContain(
      "not necessarily the engine that wrote these logs",
    );
    expect(markdown).toContain("578a2da3");
    expect(markdown).toContain("488fe528");
    expect(markdown).toContain("523a05df");
    expect(markdown).toContain("Same agent sandbox for every turn: no");
    expect(markdown).toContain("Observed fingerprints");
    expect(markdown).toContain("Estimated mints");
    expect(markdown).toContain("2 of 2");
  });
});

function execution(
  instanceId: string,
  n: number,
  sessionId: string,
  executionId: string,
  timestamp: string,
): DiagEvent {
  return {
    kind: "execution",
    timestamp,
    instanceId,
    mode: "aer",
    service: "agent",
    n,
    sessionId,
    executionId,
    uptimeSeconds: 1,
  };
}

function processStart(
  instanceId: string,
  mode: "aer" | "tool",
  timestamp: string,
): DiagEvent {
  return {
    kind: "process_start",
    timestamp,
    instanceId,
    mode,
    service: mode === "aer" ? "agent" : "tool",
    pid: 1,
    host: "fctr",
    tokenCaches: { mongodb: "absent" },
  };
}

function token(
  instanceId: string,
  fingerprint: string,
  cacheUpdatedAt: string,
  expiry: string,
): DiagEvent {
  return {
    kind: "mcp_token_cached",
    timestamp: cacheUpdatedAt,
    instanceId,
    mode: "aer",
    service: "agent",
    server: "mongodb",
    n: 1,
    fingerprint,
    expiry,
    cacheUpdatedAt,
    uptimeSeconds: 1,
  };
}

function turn(
  sessionLabel: string,
  turnNumber: number,
  status: TurnResult["status"],
  startedAt: string,
  endedAt = startedAt,
): TurnResult {
  return {
    scenario: "ramp",
    sessionLabel,
    turn: turnNumber,
    sessionId: status === "error" ? null : `sess-${sessionLabel.slice(1)}`,
    executionId: status === "error" ? null : `exec-${sessionLabel.slice(1)}`,
    startedAt,
    endedAt,
    status,
    ...(status === "error" ? { errorMessage: "Access Token limit reached" } : {}),
  };
}
