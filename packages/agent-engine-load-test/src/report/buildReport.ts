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

import type { DiagEvent } from "../logs/parseRuntimeDiag.js";
import type { TurnResult } from "../load/turnResult.js";

const TOKEN_LIFETIME_MS = 60 * 60 * 1000;

export interface RunMeta {
  runId: string;
  scenario?: string;
  workspace: string;
  workspaceId?: string;
  /** The load window, as written by `load`. Never padded. */
  since: string;
  until: string;
  /**
   * The window `fetch-logs` downloaded: the load window plus log padding.
   * Reports read this window. Absent when the run was not fetched with padding.
   */
  logWindow?: { since: string; until: string };
  orchestrationEngineImage: string | null;
  /** When `agentengine status` was read. The image is the workspace's current engine, not a historical one. */
  engineImageObservedAt: string | null;
  prompt?: string;
}

/** The window whose logs the report covers. */
export function reportWindow(meta: RunMeta): { since: string; until: string } {
  return meta.logWindow ?? { since: meta.since, until: meta.until };
}

export interface SessionTurnReport {
  turn: number;
  startedAt: string | null;
  executionId: string | null;
  agentInstanceId: string | null;
  firstExecutionOnInstance: boolean | null;
  gapSincePreviousTurnMs: number | null;
  newAgentProcessStartsAfter: number;
  newToolProcessStartsAfter: number;
  status: TurnResult["status"] | "logged";
  errorMessage?: string;
}

export interface SessionReport {
  sessionId: string | null;
  sessionLabel: string | null;
  turns: SessionTurnReport[];
  /** True when every turn with an agent instance used that same instance. */
  sameAgentSandbox: boolean | null;
}

export interface TokenReport {
  /** Distinct fingerprints whose cache_updated_at falls in the window. */
  observedCount: number;
  observedFingerprints: string[];
  /** Process starts that began with at least one empty token cache. */
  estimatedMints: number;
  /** Highest number of tokens active at once during the window. */
  peakActiveTokens: number;
}

export interface FailureReport {
  firstTokenLimitErrorAt: string | null;
  firstClientErrorAt: string | null;
  firstSuccessAfterFailureAt: string | null;
  recoveryMs: number | null;
}

export interface LoadReport {
  meta: RunMeta;
  sessions: SessionReport[];
  otherSessions: SessionReport[];
  tokens: TokenReport;
  failures: FailureReport;
  processStarts: { aer: number; tool: number };
  processStartEvents: Array<{
    timestamp: string;
    instanceId: string;
    mode: "aer" | "tool";
  }>;
  firstExecutionShare: { executions: number; firstExecutions: number };
}

type ExecutionEvent = DiagEvent & { kind: "execution" };
type ProcessStartEvent = DiagEvent & { kind: "process_start" };

export function buildReport(input: {
  meta: RunMeta;
  events: DiagEvent[];
  turns?: TurnResult[];
}): LoadReport {
  const window = reportWindow(input.meta);
  const since = Date.parse(window.since);
  const until = Date.parse(window.until);
  const events = input.events
    .filter((event) => {
      const time = Date.parse(event.timestamp);
      return time >= since && time <= until;
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const executions = events.filter(
    (event): event is ExecutionEvent => event.kind === "execution",
  );
  const processStarts = events.filter(
    (event): event is ProcessStartEvent => event.kind === "process_start",
  );

  const clientSessions = sessionsFromTurns(input.turns ?? [], executions, processStarts);
  const clientKeys = new Set(
    clientSessions.flatMap((session) =>
      [session.sessionId, session.sessionLabel].filter(
        (key): key is string => key !== null,
      ),
    ),
  );
  const logSessions = sessionsFromExecutions(executions, processStarts).filter(
    (session) =>
      session.sessionId === null || !clientKeys.has(session.sessionId),
  );

  return {
    meta: input.meta,
    sessions: input.turns && input.turns.length > 0 ? clientSessions : logSessions,
    otherSessions: input.turns && input.turns.length > 0 ? logSessions : [],
    tokens: tokenReport(events, since, until),
    failures: failureReport(events, input.turns ?? []),
    processStarts: {
      aer: processStarts.filter((event) => event.mode === "aer").length,
      tool: processStarts.filter((event) => event.mode === "tool").length,
    },
    processStartEvents: processStarts.map((event) => ({
      timestamp: event.timestamp,
      instanceId: event.instanceId,
      mode: event.mode,
    })),
    firstExecutionShare: {
      executions: executions.length,
      firstExecutions: executions.filter((event) => event.n === 1).length,
    },
  };
}

function sessionsFromTurns(
  turns: TurnResult[],
  executions: ExecutionEvent[],
  processStarts: ProcessStartEvent[],
): SessionReport[] {
  const groups = new Map<string, TurnResult[]>();
  for (const turn of turns) {
    const key = turn.sessionLabel;
    const group = groups.get(key) ?? [];
    group.push(turn);
    groups.set(key, group);
  }
  const usedExecutions = new Set<ExecutionEvent>();
  return [...groups.entries()].map(([, group]) => {
    const ordered = [...group].sort((a, b) => a.turn - b.turn);
    const sessionId = ordered.find((turn) => turn.sessionId)?.sessionId ?? null;
    const sessionExecutions = executions.filter(
      (event) => event.sessionId !== null && event.sessionId === sessionId,
    );
    const reported: SessionTurnReport[] = ordered.map((turn, index) => {
      const execution = takeExecution(turn, sessionExecutions, usedExecutions);
      const startedAt = turn.startedAt;
      const previous = ordered[index - 1];
      const boundaryStart = execution?.timestamp ?? startedAt;
      return {
        turn: turn.turn,
        startedAt,
        executionId: turn.executionId ?? execution?.executionId ?? null,
        agentInstanceId: execution?.instanceId ?? null,
        firstExecutionOnInstance:
          execution === undefined ? null : execution.n === 1,
        gapSincePreviousTurnMs: previous
          ? Date.parse(startedAt) - Date.parse(previous.startedAt)
          : null,
        ...startsBetween(
          processStarts,
          boundaryStart,
          nextExecutionAfter(boundaryStart, executions),
        ),
        status: turn.status,
        ...(turn.errorMessage ? { errorMessage: turn.errorMessage } : {}),
      };
    });
    return {
      sessionId,
      sessionLabel: ordered[0]?.sessionLabel ?? null,
      turns: reported,
      sameAgentSandbox: sameSandbox(reported),
    };
  });
}

function nextExecutionAfter(
  after: string,
  executions: ExecutionEvent[],
): string | null {
  const afterMs = Date.parse(after);
  for (const event of executions) {
    if (Date.parse(event.timestamp) > afterMs) {
      return event.timestamp;
    }
  }
  return null;
}

function takeExecution(
  turn: TurnResult,
  executions: ExecutionEvent[],
  used: Set<ExecutionEvent>,
): ExecutionEvent | undefined {
  const chosen = turn.executionId
    ? executions.find(
        (event) => event.executionId === turn.executionId && !used.has(event),
      )
    : executions.find((event) => !used.has(event));
  if (chosen) {
    used.add(chosen);
  }
  return chosen;
}

function sessionsFromExecutions(
  executions: ExecutionEvent[],
  processStarts: ProcessStartEvent[],
): SessionReport[] {
  const groups = new Map<string, Array<DiagEvent & { kind: "execution" }>>();
  for (const event of executions) {
    const key = event.sessionId ?? "(no session)";
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const turns: SessionTurnReport[] = group.map((event, index) => {
      const previous = group[index - 1];
      return {
        turn: index + 1,
        startedAt: event.timestamp,
        executionId: event.executionId,
        agentInstanceId: event.instanceId,
        firstExecutionOnInstance: event.n === 1,
        gapSincePreviousTurnMs: previous
          ? Date.parse(event.timestamp) - Date.parse(previous.timestamp)
          : null,
        ...startsBetween(
          processStarts,
          event.timestamp,
          nextExecutionAfter(event.timestamp, executions),
        ),
        status: "logged",
      };
    });
    return {
      sessionId: key === "(no session)" ? null : key,
      sessionLabel: null,
      turns,
      sameAgentSandbox: sameSandbox(turns),
    };
  });
}

function startsBetween(
  processStarts: ProcessStartEvent[],
  after: string,
  before: string | null,
): { newAgentProcessStartsAfter: number; newToolProcessStartsAfter: number } {
  const afterMs = Date.parse(after);
  const beforeMs = before === null ? Number.POSITIVE_INFINITY : Date.parse(before);
  const inRange = processStarts.filter((event) => {
    const time = Date.parse(event.timestamp);
    return time > afterMs && time < beforeMs;
  });
  return {
    newAgentProcessStartsAfter: inRange.filter((event) => event.mode === "aer")
      .length,
    newToolProcessStartsAfter: inRange.filter((event) => event.mode === "tool")
      .length,
  };
}

function sameSandbox(turns: SessionTurnReport[]): boolean | null {
  const instances = turns
    .map((turn) => turn.agentInstanceId)
    .filter((instance): instance is string => instance !== null);
  if (instances.length < 2) {
    return null;
  }
  return instances.every((instance) => instance === instances[0]);
}

function tokenReport(events: DiagEvent[], since: number, until: number): TokenReport {
  const observed = new Map<string, { start: number; end: number }>();
  const instancesWithToken = new Set<string>();
  for (const event of events) {
    if (event.kind !== "mcp_token_cached" || !event.fingerprint) {
      continue;
    }
    instancesWithToken.add(event.instanceId);
    if (observed.has(event.fingerprint) || !event.cacheUpdatedAt) {
      continue;
    }
    const start = Date.parse(event.cacheUpdatedAt);
    const end = event.expiry
      ? Date.parse(event.expiry)
      : start + TOKEN_LIFETIME_MS;
    observed.set(event.fingerprint, { start, end });
  }

  const intervals = [...observed.values()];
  let estimatedMints = 0;
  for (const event of events) {
    if (event.kind !== "process_start") {
      continue;
    }
    const absent = Object.values(event.tokenCaches).some(
      (state) => state === "absent",
    );
    if (!absent) {
      continue;
    }
    estimatedMints += 1;
    if (instancesWithToken.has(event.instanceId)) {
      continue;
    }
    const start = Date.parse(event.timestamp);
    intervals.push({ start, end: start + TOKEN_LIFETIME_MS });
  }

  const observedInWindow = [...observed.entries()]
    .filter(([, interval]) => interval.start >= since && interval.start <= until)
    .map(([fingerprint]) => fingerprint)
    .sort();

  return {
    observedCount: observedInWindow.length,
    observedFingerprints: observedInWindow,
    estimatedMints,
    peakActiveTokens: peakOverlap(intervals, since, until),
  };
}

function peakOverlap(
  intervals: Array<{ start: number; end: number }>,
  since: number,
  until: number,
): number {
  const points: Array<{ time: number; delta: number }> = [];
  for (const interval of intervals) {
    const start = Math.max(interval.start, since);
    const end = Math.min(interval.end, until);
    if (end <= start) {
      continue;
    }
    points.push({ time: start, delta: 1 });
    points.push({ time: end, delta: -1 });
  }
  points.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const point of points) {
    current += point.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

function failureReport(events: DiagEvent[], turns: TurnResult[]): FailureReport {
  const tokenErrors = events
    .filter((event) => event.kind === "token_limit_error")
    .map((event) => event.timestamp)
    .sort();
  const clientErrors = turns
    .filter((turn) => turn.status === "error")
    .map((turn) => turn.endedAt)
    .sort();
  const firstTokenLimitErrorAt = tokenErrors[0] ?? null;
  const firstClientErrorAt = clientErrors[0] ?? null;
  const failureAt = earliest(firstTokenLimitErrorAt, firstClientErrorAt);
  if (!failureAt) {
    return {
      firstTokenLimitErrorAt,
      firstClientErrorAt,
      firstSuccessAfterFailureAt: null,
      recoveryMs: null,
    };
  }
  const failureMs = Date.parse(failureAt);
  // Client turns decide success when present. An execution line is written in
  // prepareAgentInput, before the turn finishes, so it cannot show the turn worked.
  // Execution lines are the only signal for logs-only reports.
  const successes =
    turns.length > 0
      ? turns
          .filter(
            (turn) =>
              (turn.status === "completed" || turn.status === "suspended") &&
              Date.parse(turn.startedAt) > failureMs,
          )
          .map((turn) => turn.startedAt)
      : events
          .filter(
            (event) =>
              event.kind === "execution" && Date.parse(event.timestamp) > failureMs,
          )
          .map((event) => event.timestamp);
  const firstSuccessAfterFailureAt = [...successes].sort()[0] ?? null;
  return {
    firstTokenLimitErrorAt,
    firstClientErrorAt,
    firstSuccessAfterFailureAt,
    recoveryMs: firstSuccessAfterFailureAt
      ? Date.parse(firstSuccessAfterFailureAt) - failureMs
      : null,
  };
}

function earliest(a: string | null, b: string | null): string | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return a < b ? a : b;
}
