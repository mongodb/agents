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

import type { RunRecord, Severity } from "./types.ts";

export type RunStatus = "pass" | "fail" | "review" | "error";

/**
 * Deterministic checks decide first. The judge can only turn a passing run into a
 * fail or "review" (its unsure verdicts), never rescue a deterministic failure.
 */
export function runStatus(record: RunRecord): RunStatus {
  if (record.error) return "error";
  if (!record.deterministicPass) return "fail";
  if (record.judge?.some((verdict) => verdict.verdict === "fail")) return "fail";
  if (record.judge?.some((verdict) => verdict.verdict === "unsure")) return "review";
  return "pass";
}

export interface CaseOutcome {
  status: "pass" | "fail" | "error";
  passed: number;
  failed: number;
  review: number;
  errored: number;
  runs: number;
}

/**
 * High severity: any failing run fails the case. Otherwise at least 2 of 3 scored runs
 * must pass. "review" runs count as passing here but are listed for a human.
 */
export function caseOutcome(severity: Severity, records: readonly RunRecord[]): CaseOutcome {
  const statuses = records.map(runStatus);
  const count = (status: RunStatus) => statuses.filter((s) => s === status).length;
  const passed = count("pass") + count("review");
  const failed = count("fail");
  const errored = count("error");
  const scored = passed + failed;
  let status: CaseOutcome["status"];
  if (scored === 0) {
    status = "error";
  } else if (severity === "High") {
    status = failed > 0 ? "fail" : "pass";
  } else {
    status = passed * 3 >= scored * 2 ? "pass" : "fail";
  }
  return { status, passed: count("pass"), failed, review: count("review"), errored, runs: records.length };
}
