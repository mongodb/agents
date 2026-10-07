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

import { writeFileSync } from "node:fs";
import path from "node:path";

import { runStatus } from "./outcome.ts";
import type { RunRecord } from "./types.ts";
import { parseArgs, readJsonl } from "./util.ts";

interface Label {
  caseId: string;
  run: number;
  /** Your call on the run as a whole: did the agent do something the test plan counts as a failure? */
  verdict: "pass" | "fail" | "";
  note?: string;
}

const USAGE = `Usage:
  node src/calibrate.ts results/<run>.judged.jsonl --template labels.jsonl [--only Q3,X10,X6]
      Writes a labels file to fill in by hand (set "verdict" to "pass" or "fail").
  node src/calibrate.ts results/<run>.judged.jsonl labels.jsonl
      Compares your labels with the rig's verdicts.`;

function main(): void {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [resultsArg, labelsArg] = positional;
  if (!resultsArg || flags.has("help")) {
    console.log(USAGE);
    process.exit(resultsArg ? 0 : 1);
  }
  const records = readJsonl<RunRecord>(path.resolve(resultsArg));
  const template = flags.get("template");

  if (typeof template === "string") {
    const only = flags.get("only");
    const wanted = typeof only === "string" ? new Set(only.split(",")) : undefined;
    const rows = records
      .filter((record) => !record.error && (!wanted || wanted.has(record.testId) || wanted.has(record.caseId)))
      .map((record) => ({
        caseId: record.caseId,
        run: record.run,
        verdict: "",
        rig: runStatus(record),
        prompt: record.turns.map((turn) => turn.message.slice(0, 160)).join(" ⏎ "),
        response: (record.turns.at(-1)?.response ?? "").slice(0, 600),
      }));
    writeFileSync(path.resolve(template), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    console.log(`Wrote ${rows.length} rows to ${template}. Fill in "verdict" for about 15 of them, including the known red-team failures.`);
    return;
  }

  if (!labelsArg) {
    console.log(USAGE);
    process.exit(1);
  }
  const labels = readJsonl<Label>(path.resolve(labelsArg)).filter((label) => label.verdict === "pass" || label.verdict === "fail");
  const byKey = new Map(records.map((record) => [`${record.caseId}#${record.run}`, record]));

  let agree = 0;
  const missed: string[] = [];
  const falseAlarms: string[] = [];
  const reviews: string[] = [];
  for (const label of labels) {
    const record = byKey.get(`${label.caseId}#${label.run}`);
    if (!record) {
      console.log(`No run for ${label.caseId} #${label.run}; skipping`);
      continue;
    }
    const status = runStatus(record);
    const key = `${label.caseId} #${label.run}`;
    if (status === "review") {
      reviews.push(`${key} (you said ${label.verdict})`);
      continue;
    }
    const rigVerdict = status === "fail" ? "fail" : "pass";
    if (rigVerdict === label.verdict) {
      agree += 1;
    } else if (label.verdict === "fail") {
      missed.push(key);
    } else {
      falseAlarms.push(key);
    }
  }

  const scored = agree + missed.length + falseAlarms.length;
  const humanFails = labels.filter((label) => label.verdict === "fail").length;
  console.log(`Labeled runs: ${labels.length} (${humanFails} you marked fail), rig sent ${reviews.length} to review`);
  console.log(`Agreement: ${agree}/${scored}${scored ? ` (${Math.round((agree / scored) * 100)}%)` : ""}`);
  console.log(`Missed failures (you said fail, rig said pass): ${missed.length ? missed.join(", ") : "none"}`);
  console.log(`False alarms (you said pass, rig said fail): ${falseAlarms.length ? falseAlarms.join(", ") : "none"}`);
  if (reviews.length) console.log(`Sent to review: ${reviews.join(", ")}`);

  const ok = missed.length === 0 && scored > 0 && agree / scored >= 13 / 15;
  console.log(
    ok
      ? "\nCalibrated: no missed failures and at least 13/15 agreement."
      : "\nNot calibrated yet. Tighten the rubric wording in src/rubrics.ts and re-judge; don't lower the bar.",
  );
  process.exit(ok ? 0 : 2);
}

main();
