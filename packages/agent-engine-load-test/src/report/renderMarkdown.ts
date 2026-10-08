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

import { reportWindow, type LoadReport, type SessionReport } from "./buildReport.js";

export function renderMarkdown(report: LoadReport): string {
  const { meta } = report;
  const window = reportWindow(meta);
  const lines = [
    "# MCP token load report",
    "",
    `- Run: \`${meta.runId}\``,
    `- Scenario: ${meta.scenario ?? "(logs only)"}`,
    `- Workspace: \`${meta.workspace}\`${meta.workspaceId ? ` (\`${meta.workspaceId}\`)` : ""}`,
    `- Window: ${window.since} to ${window.until}`,
    `- Orchestration Engine: ${formatEngine(meta)}`,
    ...(meta.prompt ? [`- Prompt: ${meta.prompt}`] : []),
    "",
    "## Sessions",
    "",
    ...renderSessions(report.sessions),
  ];
  if (report.otherSessions.length > 0) {
    lines.push(
      "## Other sessions in the logs",
      "",
      "These executions were in the window but were not part of the load-test client log.",
      "",
      ...renderSessions(report.otherSessions),
    );
  }
  lines.push(
    "## Tokens",
    "",
    `- Observed fingerprints with \`cache_updated_at\` in the window: ${report.tokens.observedCount}`,
    `- Estimated mints (process starts with an empty token cache): ${report.tokens.estimatedMints}`,
    `- Peak active tokens during the window: ${report.tokens.peakActiveTokens}`,
    "",
    "Observed counts only tokens a process logged after writing its cache. A sandbox that is paused before the diagnostics poll runs does not log the token it minted at startup, so the observed count is lower than the number of mints. Estimated mints count process starts whose cache was empty. A process start that later logs a token is not also counted in the peak.",
    "",
    "## Failures",
    "",
    ...renderFailures(report),
    "",
    "## Process starts",
    "",
    `- Agent sandboxes: ${report.processStarts.aer}`,
    `- Tool sandboxes: ${report.processStarts.tool}`,
    ...report.processStartEvents.map(
      (event) =>
        `  - ${event.timestamp} ${event.mode} \`${event.instanceId}\``,
    ),
    `- Executions on a process's first execution: ${report.firstExecutionShare.firstExecutions} of ${report.firstExecutionShare.executions}`,
    "",
  );
  return lines.join("\n");
}

function formatEngine(meta: LoadReport["meta"]): string {
  if (!meta.orchestrationEngineImage) {
    return "unknown (`agentengine status` did not report component_images.oe)";
  }
  const when = meta.engineImageObservedAt
    ? ` (from \`agentengine status\` at ${meta.engineImageObservedAt})`
    : "";
  const observedAt = meta.engineImageObservedAt;
  const window = reportWindow(meta);
  const outsideWindow =
    observedAt !== null &&
    (observedAt < window.since || observedAt > window.until);
  const historical = outsideWindow
    ? " This is the engine at report time, not necessarily the engine that wrote these logs."
    : "";
  return `\`${meta.orchestrationEngineImage}\`${when}${historical}`;
}

function renderSessions(sessions: SessionReport[]): string[] {
  if (sessions.length === 0) {
    return ["No executions in this window.", ""];
  }
  const lines: string[] = [];
  for (const session of sessions) {
    const title = session.sessionLabel
      ? `${session.sessionLabel}${session.sessionId ? ` (\`${session.sessionId}\`)` : ""}`
      : `\`${session.sessionId ?? "(no session)"}\``;
    lines.push(`### ${title}`, "");
    lines.push(
      "| Turn | Time | Agent instance | First execution | Gap | New agent sandboxes after | New tool sandboxes after |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const turn of session.turns) {
      lines.push(
        `| ${turn.turn} | ${turn.startedAt ?? ""} | ${turn.agentInstanceId ?? ""} | ${formatFirst(turn.firstExecutionOnInstance)} | ${formatGap(turn.gapSincePreviousTurnMs)} | ${turn.newAgentProcessStartsAfter} | ${turn.newToolProcessStartsAfter} |`,
      );
    }
    lines.push(
      "",
      `Same agent sandbox for every turn: ${formatSame(session.sameAgentSandbox)}`,
      "",
    );
    const errors = session.turns.filter((turn) => turn.errorMessage);
    for (const turn of errors) {
      lines.push(
        `Turn ${turn.turn} failed: ${turn.errorMessage?.replaceAll("|", "\\|")}`,
        "",
      );
    }
  }
  lines.push(
    "Tool sandboxes do not log the session id, so the tool column counts new tool processes between turns. It does not name the tool sandbox that served the turn.",
    "",
  );
  return lines;
}

function renderFailures(report: LoadReport): string[] {
  const { failures } = report;
  if (
    !failures.firstTokenLimitErrorAt &&
    !failures.firstClientErrorAt
  ) {
    return ["None."];
  }
  const lines = [
    `- First \`Access Token limit reached\` log: ${failures.firstTokenLimitErrorAt ?? "none"}`,
    `- First client error: ${failures.firstClientErrorAt ?? "none"}`,
  ];
  if (failures.firstSuccessAfterFailureAt && failures.recoveryMs !== null) {
    lines.push(
      `- First successful turn after the failure: ${failures.firstSuccessAfterFailureAt} (${formatGap(failures.recoveryMs)} later)`,
    );
  } else {
    lines.push("- No successful turn after the failure in this window.");
  }
  return lines;
}

function formatFirst(value: boolean | null): string {
  if (value === null) {
    return "";
  }
  return value ? "yes" : "no";
}

function formatSame(value: boolean | null): string {
  if (value === null) {
    return "unknown (fewer than two turns ran on a logged agent sandbox)";
  }
  return value ? "yes" : "no";
}

export function formatGap(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const sign = ms < 0 ? "-" : "";
  const seconds = Math.round(Math.abs(ms) / 1000);
  if (seconds < 60) {
    return `${sign}${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest === 0 ? `${sign}${minutes}m` : `${sign}${minutes}m ${rest}s`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest === 0
    ? `${sign}${hours}h`
    : `${sign}${hours}h ${minuteRest}m`;
}
