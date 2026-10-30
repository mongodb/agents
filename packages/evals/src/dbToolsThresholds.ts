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

/**
 * Mean scores of the database tools suite with the production model
 * (`gpt-6-luna`): the four `db-tools*` datasets, 50 cases x 5 trials, run on
 * 2026-10-29. Braintrust run:
 * https://www.braintrust.dev/app/mongodb-education-ai/p/agents-evals/experiments/explorer%3Fmodel%3Dgpt-6-luna%26runId%3D1793306953032
 *
 * Re-run and update these when the Explorer's prompt, tools or model change.
 */
export const DB_TOOLS_EXPLORER_BASELINE = {
  AnswerMatches: 1,
  ApprovalRequested: 1,
  MongoCheck: 0.99,
  NoForbiddenExecuted: 1,
  QueryRefusalMatch: 1,
  /** 3 of 20 read-only write requests inspected the schema or knowledge first. */
  ToolCallAmountCorrect: 0.85,
  ToolCallArgCoverage: 1,
  /** Capped when the agent explores before the call. See the README. */
  ToolCallCoverage: 0.85,
} as const;

/** How far below the baseline a run may fall before the validator fails. */
export const DB_TOOLS_EXPLORER_MARGIN = 0.05;

function floorToHundredth(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

export const DB_TOOLS_EXPLORER_THRESHOLDS: Readonly<Record<string, number>> =
  Object.fromEntries(
    Object.entries(DB_TOOLS_EXPLORER_BASELINE).map(([name, mean]) => [
      name,
      floorToHundredth(mean - DB_TOOLS_EXPLORER_MARGIN),
    ]),
  );
