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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { CASES } from "./cases.ts";
import { GROUND_TRUTH_FILE, fillPlaceholders, groveSettings } from "./config.ts";
import { complete } from "./grove.ts";
import { buildJudgePrompt, parseVerdict } from "./judgeCore.ts";
import { JUDGE_SYSTEM_PROMPT } from "./rubrics.ts";
import { readMeta, splitResultsPath, writeSummaryFiles } from "./summary.ts";
import type { JudgeVerdict, RunRecord } from "./types.ts";
import { mapPool, parseArgs, readJsonl, writeJsonl } from "./util.ts";

async function main(): Promise<void> {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  if (!file || flags.has("help")) {
    console.log("Usage: node src/judge.ts results/<run>.jsonl [--concurrency 4]");
    process.exit(file ? 0 : 1);
  }
  const resultsFile = path.resolve(file);
  const { stem } = splitResultsPath(resultsFile);
  const concurrency = flags.has("concurrency") ? Number(flags.get("concurrency")) : 4;
  const settings = groveSettings();
  const casesById = new Map(CASES.map((evalCase) => [evalCase.id, evalCase]));
  const groundTruth: Record<string, unknown> = existsSync(GROUND_TRUTH_FILE)
    ? (JSON.parse(readFileSync(GROUND_TRUTH_FILE, "utf8")) as Record<string, unknown>)
    : {};
  if (!existsSync(GROUND_TRUTH_FILE)) {
    console.log("No ground-truth.json; GROUNDED_ANSWER runs without ground truth. See seed/ground-truth.mongosh.js.");
  }

  // Fail fast on auth, VPN, or URL problems before fanning out.
  const probe = await complete(settings, JUDGE_SYSTEM_PROMPT, 'Reply with {"verdict":"pass","reason":"ok","quote":""}');
  if (!probe.includes("{")) throw new Error(`Grove probe returned no JSON: ${probe.slice(0, 200)}`);

  const records = readJsonl<RunRecord>(resultsFile);
  const jobs = records.flatMap((record, index) => {
    const evalCase = casesById.get(record.caseId);
    if (!evalCase?.judge || record.error) return [];
    return evalCase.judge.rubrics.map((rubric) => ({ index, record, rubric, judge: evalCase.judge! }));
  });
  console.log(`Judging ${jobs.length} rubric checks across ${records.length} runs with ${settings.model}`);

  const verdicts = new Map<number, JudgeVerdict[]>();
  let done = 0;
  await mapPool(jobs, concurrency, async ({ index, record, rubric, judge }) => {
    const groundTruthValue = judge.groundTruthKey ? groundTruth[judge.groundTruthKey] : undefined;
    const prompt = buildJudgePrompt({
      record,
      rubric,
      ...(judge.context ? { context: fillPlaceholders(judge.context) } : {}),
      ...(groundTruthValue !== undefined ? { groundTruth: groundTruthValue } : {}),
    });
    let verdict: JudgeVerdict;
    try {
      const raw = await complete(settings, JUDGE_SYSTEM_PROMPT, prompt);
      verdict = parseVerdict(rubric, raw, record.turns.map((turn) => turn.response).join("\n\n"));
    } catch (error) {
      verdict = { rubric, verdict: "unsure", reason: `Judge call failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    verdicts.set(index, [...(verdicts.get(index) ?? []), verdict]);
    done += 1;
    console.log(`[${String(done).padStart(3)}/${jobs.length}] ${verdict.verdict.padEnd(6)} ${record.caseId} #${record.run} ${rubric}`);
  });

  const judged = records.map((record, index) => ({ ...record, judge: verdicts.get(index) ?? [] }));
  const judgedFile = `${stem}.judged.jsonl`;
  writeJsonl(judgedFile, judged);
  const { summaryFile } = writeSummaryFiles(stem, readMeta(stem), judged, ".judged");
  console.log(`\nJudged results: ${judgedFile}\nSummary: ${summaryFile}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
