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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CASES } from "./cases.ts";
import { caseOutcome, runStatus, type CaseOutcome } from "./outcome.ts";
import type { RunMeta, RunRecord, Severity, WorkspaceKey } from "./types.ts";
import { percentile, readJsonl } from "./util.ts";

const AGENT_LABEL: Record<WorkspaceKey, string> = {
  readonly: "Read-only",
  write: "Explorer",
  queryInsights: "Query Insights",
};

const SEVERITY_ORDER: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 };

/** Seed scripts and post-run checks, shown for cases that depend on them. */
const SEED_NOTES = new Map(
  CASES.filter((evalCase) => evalCase.requiresSeed).map((evalCase) => [evalCase.id, evalCase.requiresSeed!]),
);

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function truncate(text: string, max = 220): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Why a run failed, in one line: failing deterministic checks first, then judge fails. */
export function failureReasons(record: RunRecord): string[] {
  const reasons = record.checks
    .filter((check) => !check.passed)
    .map((check) => (check.detail ? `${check.name} (${check.detail})` : check.name));
  for (const verdict of record.judge ?? []) {
    if (verdict.verdict === "fail") {
      reasons.push(`judge ${verdict.rubric}: ${verdict.reason}${verdict.quote ? ` "${verdict.quote}"` : ""}`);
    }
  }
  return reasons;
}

interface CaseRow {
  caseId: string;
  testId: string;
  goal: string;
  severity: Severity;
  workspace: WorkspaceKey;
  outcome: CaseOutcome;
  records: RunRecord[];
}

function groupCases(records: readonly RunRecord[]): CaseRow[] {
  const byCase = new Map<string, RunRecord[]>();
  for (const record of records) {
    byCase.set(record.caseId, [...(byCase.get(record.caseId) ?? []), record]);
  }
  return [...byCase.values()]
    .map((runs) => {
      const first = runs[0]!;
      return {
        caseId: first.caseId,
        testId: first.testId,
        goal: first.goal,
        severity: first.severity,
        workspace: first.workspace,
        outcome: caseOutcome(first.severity, runs),
        records: runs.sort((a, b) => a.run - b.run),
      };
    })
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.testId.localeCompare(b.testId, undefined, { numeric: true }) ||
        a.caseId.localeCompare(b.caseId),
    );
}

export function buildSummary(meta: RunMeta, records: readonly RunRecord[], resultsName: string): string {
  const rows = groupCases(records);
  const judged = records.some((record) => record.judge !== undefined);
  const lines: string[] = [];
  const count = (status: CaseOutcome["status"]) => rows.filter((row) => row.outcome.status === status).length;

  lines.push(`# Eval summary: ${meta.label}`, "");
  lines.push(`- Started: ${meta.startedAt}`);
  if (meta.concurrency) lines.push(`- Concurrency: ${meta.concurrency} independent conversations`);
  if (meta.verifiedSeeds?.length) lines.push(`- Manually verified seeds: ${meta.verifiedSeeds.join(", ")}`);
  lines.push(`- Agent Engine: ${meta.baseUrl}`);
  if (meta.projectId) lines.push(`- Project: ${meta.projectId}`);
  lines.push(
    `- Workspaces: ${Object.entries(meta.workspaces).map(([key, id]) => `${key}=${id}`).join(", ") || "none"}`,
  );
  lines.push(`- Rig checkout: ${meta.gitHead} (record the **deployed** commit separately)`);
  lines.push(`- Results file: \`${resultsName}\``);
  if (meta.readonlyFallback) {
    lines.push("- **Read-only fallback:** read-only cases ran on the write-enabled workspace and X1 was skipped. Approval requests were rejected; the case rules still require none.");
  }
  lines.push(`- Judge: ${judged ? "yes" : "not yet (deterministic checks only)"}`);
  const capacityRetries = records.reduce((sum, record) => sum + record.turns.reduce((n, turn) => n + (turn.capacityRetries ?? 0), 0), 0);
  lines.push(`- Capacity retries: ${capacityRetries}`);
  lines.push(
    `- Cases: ${rows.length} (${count("pass")} pass, ${count("fail")} fail, ${count("error")} error), runs: ${records.length}, skipped: ${meta.skipped.length}`,
  );
  lines.push("");

  // Tool checks like "only read tools" pass on an empty list, so an empty stream would look clean.
  const scoredRuns = records.filter((record) => !record.error);
  if (scoredRuns.length && scoredRuns.every((record) => record.tools.length === 0)) {
    lines.push(
      "> [!WARNING]",
      "> No run recorded a single tool call. The platform may not stream `tool_name` in progress events, so every tool check (`only_read_tools`, `never_calls`, `calls`) is unreliable for this run. Check the raw `progress` field in the results file and the Agent Engine traces.",
      "",
    );
  }

  const highFails = rows.filter((row) => row.severity === "High" && row.outcome.status === "fail");
  lines.push("## High-severity failures", "");
  if (!highFails.length) {
    lines.push("None.", "");
  } else {
    lines.push("| Case | Test | Agent | Failed runs | Why (first failing run) |", "| --- | --- | --- | --- | --- |");
    for (const row of highFails) {
      const firstFail = row.records.find((record) => runStatus(record) === "fail");
      lines.push(
        `| ${row.caseId} | ${row.testId} | ${AGENT_LABEL[row.workspace]} | ${row.outcome.failed}/${row.outcome.runs} | ${cell(truncate(failureReasons(firstFail!).join("; ")))} |`,
      );
    }
    lines.push("");
  }

  lines.push("## By test ID", "", "| Test | Cases | Pass | Fail | Error | Runs needing review |", "| --- | --- | --- | --- | --- | --- |");
  const testIds = [...new Set(rows.map((row) => row.testId))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const testId of testIds) {
    const group = rows.filter((row) => row.testId === testId);
    const of = (status: CaseOutcome["status"]) => group.filter((row) => row.outcome.status === status).length;
    const review = group.reduce((sum, row) => sum + row.outcome.review, 0);
    lines.push(`| ${testId} | ${group.length} | ${of("pass")} | ${of("fail")} | ${of("error")} | ${review} |`);
  }
  lines.push("");

  lines.push("## Needs human review", "");
  const reviewItems = records
    .filter((record) => {
      const status = runStatus(record);
      return status === "fail" || status === "review";
    })
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.caseId.localeCompare(b.caseId) || a.run - b.run);
  if (!reviewItems.length) {
    lines.push("Nothing flagged.", "");
  } else {
    for (const record of reviewItems) {
      const reasons = failureReasons(record);
      const unsure = (record.judge ?? []).filter((verdict) => verdict.verdict === "unsure");
      lines.push(`- **${record.caseId} #${record.run}** (${record.severity}, ${runStatus(record)})`);
      for (const reason of reasons) lines.push(`  - ${truncate(reason, 400)}`);
      for (const verdict of unsure) lines.push(`  - judge ${verdict.rubric} unsure: ${truncate(verdict.reason, 300)}`);
    }
    lines.push("");
  }

  const errored = records.filter((record) => record.error);
  if (errored.length) {
    lines.push("## Invocation errors", "");
    for (const record of errored) lines.push(`- ${record.caseId} #${record.run}: ${truncate(record.error!, 300)}`);
    lines.push("");
  }

  const verify = rows.filter((row) => SEED_NOTES.has(row.caseId));
  if (verify.length) {
    lines.push("## Seeds and manual verification", "");
    for (const row of verify) lines.push(`- ${row.caseId}: ${SEED_NOTES.get(row.caseId)}`);
    lines.push("");
  }

  lines.push("## Latency (Q6)", "", "| Agent | Turns | p50 | p95 | Max |", "| --- | --- | --- | --- | --- |");
  for (const workspace of Object.keys(AGENT_LABEL) as WorkspaceKey[]) {
    const latencies = records
      .filter((record) => record.workspace === workspace && !record.error)
      .flatMap((record) => record.turns.map((turn) => turn.latencyMs));
    if (!latencies.length) continue;
    const seconds = (ms: number | undefined) => (ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}s`);
    lines.push(
      `| ${AGENT_LABEL[workspace]} | ${latencies.length} | ${seconds(percentile(latencies, 50))} | ${seconds(percentile(latencies, 95))} | ${seconds(Math.max(...latencies))} |`,
    );
  }
  lines.push("");

  lines.push(
    "## Rows for the Results tab",
    "",
    "| Test ID | Goal | Link | Author | Agent | Outcome | Severity | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const row of rows) {
    if (row.outcome.status === "error") continue;
    const firstFail = row.records.find((record) => runStatus(record) === "fail");
    const notes =
      `${row.outcome.passed} pass / ${row.outcome.failed} fail / ${row.outcome.review} review of ${row.outcome.runs} runs. ` +
      `Prompt: ${truncate(row.records[0]!.turns.map((turn) => turn.message).join(" ⏎ "), 160)}` +
      (firstFail ? `. Why: ${failureReasons(firstFail).join("; ")}` : "");
    lines.push(
      `| ${row.testId} | ${cell(row.goal)} | ${resultsName}#${row.caseId} | eval rig | ${AGENT_LABEL[row.workspace]} | ${row.outcome.status === "pass" ? "👍" : "👎"} | ${row.outcome.status === "pass" ? "-" : row.severity} | ${cell(truncate(notes, 500))} |`,
    );
  }
  lines.push("");

  if (meta.skipped.length) {
    lines.push("## Skipped", "");
    for (const { caseId, reason } of meta.skipped) lines.push(`- ${caseId}: ${reason}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function writeSummaryFiles(stem: string, meta: RunMeta, records: readonly RunRecord[], suffix = ""): { summaryFile: string } {
  const summaryFile = `${stem}${suffix}-summary.md`;
  writeFileSync(summaryFile, buildSummary(meta, records, path.basename(`${stem}${suffix}.jsonl`)));
  return { summaryFile };
}

/** `results/<stem>.jsonl` or `results/<stem>.judged.jsonl` -> stem and suffix. */
export function splitResultsPath(file: string): { stem: string; suffix: string } {
  const judged = file.endsWith(".judged.jsonl");
  return { stem: file.replace(/(\.judged)?\.jsonl$/, ""), suffix: judged ? ".judged" : "" };
}

export function readMeta(stem: string): RunMeta {
  const metaFile = `${stem}.meta.json`;
  if (!existsSync(metaFile)) throw new Error(`Missing ${metaFile}`);
  return JSON.parse(readFileSync(metaFile, "utf8")) as RunMeta;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node src/summary.ts results/<run>.jsonl|<run>.judged.jsonl");
    process.exit(1);
  }
  const { stem, suffix } = splitResultsPath(path.resolve(file));
  const { summaryFile } = writeSummaryFiles(stem, readMeta(stem), readJsonl<RunRecord>(path.resolve(file)), suffix);
  console.log(`Summary: ${summaryFile}`);
}
