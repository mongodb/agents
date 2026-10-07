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

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { converse, createClients } from "./agent.ts";
import { CASES } from "./cases.ts";
import { evaluate } from "./checks.ts";
import { RESULTS_DIR, WORKSPACE_ENV, agentEngineSettings, fillPlaceholders, missingPlaceholders } from "./config.ts";
import { writeSummaryFiles } from "./summary.ts";
import type { EvalCase, RunMeta, RunRecord } from "./types.ts";
import { appendJsonl, gitHead, mapPool, parseArgs, timestamp } from "./util.ts";

const USAGE = `Usage: node src/run.ts [options]

  --only X1,Q3,Q4-list-collections-mflix   test IDs or case IDs to run (default: all)
  --runs N                                 runs per case (default: each case's runs, else 3)
  --concurrency N                          parallel conversations (default: 1; limited by workspace session capacity)
  --label TEXT                             label for this run, e.g. baseline or post-redeploy
  --verified-seeds X6,X7,Q2                 seed-dependent tests with manually verified data
  --list                                   print the selected cases and exit
  --dry-run                                print what would run, without calling the agents`;

function selectCases(only: string | undefined): EvalCase[] {
  if (!only) return CASES;
  const wanted = new Set(only.split(",").map((item) => item.trim()).filter(Boolean));
  const selected = CASES.filter((evalCase) => wanted.has(evalCase.testId) || wanted.has(evalCase.id));
  const known = new Set(CASES.flatMap((evalCase) => [evalCase.id, evalCase.testId]));
  const unknown = [...wanted].filter((item) => !known.has(item));
  if (unknown.length) throw new Error(`Unknown test or case IDs: ${unknown.join(", ")}`);
  return selected;
}

function fillCase(evalCase: EvalCase): EvalCase {
  return {
    ...evalCase,
    turns: evalCase.turns.map(fillPlaceholders),
    ...(evalCase.expect
      ? {
          expect: {
            ...evalCase.expect,
            ...(evalCase.expect.mustMatch
              ? {
                  mustMatch: evalCase.expect.mustMatch.map((spec) =>
                    typeof spec === "string"
                      ? fillPlaceholders(spec)
                      : { ...spec, pattern: fillPlaceholders(spec.pattern) },
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log(USAGE);
    return;
  }
  const only = flags.get("only");
  const cases = selectCases(typeof only === "string" ? only : undefined);
  const runsOverride = flags.has("runs") ? Number(flags.get("runs")) : undefined;
  const concurrency = flags.has("concurrency") ? Number(flags.get("concurrency")) : 1;
  const label = typeof flags.get("label") === "string" ? (flags.get("label") as string) : "adhoc";
  const verifiedSeeds = typeof flags.get("verified-seeds") === "string"
    ? String(flags.get("verified-seeds")).split(",").map((item) => item.trim()).filter(Boolean)
    : [];

  if (flags.has("list")) {
    for (const evalCase of cases) {
      console.log(`${evalCase.id.padEnd(32)} ${evalCase.testId.padEnd(4)} ${evalCase.severity.padEnd(6)} ${evalCase.workspace.padEnd(13)} ${evalCase.goal}`);
    }
    console.log(`\n${cases.length} cases`);
    return;
  }

  const dryRun = flags.has("dry-run");
  const settings = dryRun ? undefined : agentEngineSettings();
  const readonlyFallback =
    process.env.AE_READONLY_FALLBACK?.trim() === "write" && !process.env.AE_WS_EXPLORER_READONLY?.trim();
  const skipped: RunMeta["skipped"] = [];
  const runnable: EvalCase[] = [];
  for (const original of cases) {
    let evalCase = original;
    if (readonlyFallback && evalCase.workspace === "readonly") {
      // X1 is about the read-only credential itself, so it can't borrow the write workspace.
      if (evalCase.testId === "X1") {
        skipped.push({ caseId: evalCase.id, reason: "needs a read-only Explorer workspace (AE_READONLY_FALLBACK is on)" });
        continue;
      }
      evalCase = { ...evalCase, workspace: "write" };
    }
    const missing = evalCase.turns.flatMap(missingPlaceholders);
    if (missing.length) {
      skipped.push({ caseId: evalCase.id, reason: `missing env: ${[...new Set(missing)].join(", ")}` });
      continue;
    }
    if (!process.env[WORKSPACE_ENV[evalCase.workspace]]?.trim()) {
      skipped.push({ caseId: evalCase.id, reason: `no ${WORKSPACE_ENV[evalCase.workspace]} set` });
      continue;
    }
    if (evalCase.requiresSeed && ["X6", "X7", "Q2"].includes(evalCase.testId) && !verifiedSeeds.includes(evalCase.testId)) {
      skipped.push({ caseId: evalCase.id, reason: `seed data unverified: ${evalCase.requiresSeed}; verify it before using --verified-seeds ${evalCase.testId}` });
      continue;
    }
    runnable.push(fillCase(evalCase));
  }

  const jobs = runnable.flatMap((evalCase) =>
    Array.from({ length: runsOverride ?? evalCase.runs ?? 3 }, (_, i) => ({ evalCase, run: i + 1 })),
  );

  for (const { caseId, reason } of skipped) console.log(`SKIP  ${caseId}: ${reason}`);
  if (dryRun) {
    for (const { evalCase, run } of jobs) console.log(`would run ${evalCase.id} #${run} on ${evalCase.workspace}`);
    console.log(`\n${jobs.length} runs across ${runnable.length} cases (${skipped.length} skipped)`);
    return;
  }
  if (!jobs.length) {
    console.log("Nothing to run.");
    return;
  }

  const clients = createClients(settings!);
  const startedAt = new Date();
  const stem = path.join(RESULTS_DIR, `${timestamp(startedAt)}-${label.replace(/[^\w.-]+/g, "_")}`);
  const resultsFile = `${stem}.jsonl`;
  const meta: RunMeta = {
    startedAt: startedAt.toISOString(),
    concurrency,
    verifiedSeeds,
    label,
    gitHead: gitHead(),
    baseUrl: settings!.baseUrl,
    projectId: settings!.projectId,
    workspaces: settings!.workspaces,
    caseCount: runnable.length,
    skipped,
    ...(readonlyFallback ? { readonlyFallback: true } : {}),
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(`${stem}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
  if (readonlyFallback) console.log("AE_READONLY_FALLBACK=write: read-only cases run on the write workspace; X1 skipped.");
  console.log(`Running ${jobs.length} conversations (${runnable.length} cases, concurrency ${concurrency})`);
  console.log(`Results: ${resultsFile}\n`);

  // Stop after a streak of invocation errors (for example the agent failing to start) instead of
  // hammering a shared workspace that red-teamers and the Slack bot also use.
  const MAX_CONSECUTIVE_ERRORS = Number(process.env.EVAL_MAX_CONSECUTIVE_ERRORS || 4);
  let consecutiveErrors = 0;
  let aborted: string | undefined;
  let done = 0;
  const records = (await mapPool(jobs, concurrency, async ({ evalCase, run }) => {
    if (aborted) return undefined;
    const started = new Date();
    const output = await converse(clients[evalCase.workspace]!, evalCase.turns);
    const record: RunRecord = {
      caseId: evalCase.id,
      testId: evalCase.testId,
      goal: evalCase.goal,
      severity: evalCase.severity,
      workspace: evalCase.workspace,
      run,
      startedAt: started.toISOString(),
      completedAt: new Date().toISOString(),
      ...(output.sessionId ? { sessionId: output.sessionId } : {}),
      turns: output.turns,
      tools: output.tools,
      interrupts: output.interrupts,
      progress: output.progress,
      ...(output.error ? { error: output.error } : {}),
      checks: [],
      deterministicPass: false,
    };
    record.checks = evaluate(evalCase, record);
    record.deterministicPass = record.checks.every((check) => check.passed);
    appendJsonl(resultsFile, record);

    done += 1;
    const status = record.error ? "ERROR" : record.deterministicPass ? "pass " : "FAIL ";
    const latency = record.turns.reduce((sum, turn) => sum + turn.latencyMs, 0);
    const waits = record.turns.reduce((sum, turn) => sum + (turn.capacityRetries ?? 0), 0);
    const failed = record.checks.filter((check) => !check.passed).map((check) => check.name);
    consecutiveErrors = record.error ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && !aborted) {
      aborted = record.error;
    }
    console.log(
      `[${String(done).padStart(3)}/${jobs.length}] ${status} ${evalCase.id} #${run} ${(latency / 1000).toFixed(1)}s` +
        (waits ? ` (${waits} capacity retr${waits === 1 ? "y" : "ies"})` : "") +
        (failed.length ? `  ${failed.join(", ")}` : ""),
    );
    return record;
  })).filter((record): record is RunRecord => record !== undefined);

  if (aborted) {
    console.log(
      `\nSTOPPED after ${MAX_CONSECUTIVE_ERRORS} invocation errors in a row; ${jobs.length - records.length} runs not attempted.\nLast error: ${aborted}\nCheck the workspace (agentengine status / logs) before re-running.`,
    );
  }
  const { summaryFile } = writeSummaryFiles(stem, meta, records);
  console.log(`\nSummary: ${summaryFile}`);
  console.log(`Judge next (needs a judge gateway, see example.env): node src/judge.ts ${resultsFile}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
