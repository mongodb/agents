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
 * Mean scores of the Query Insights report suite with the production model
 * (`gpt-6.1-terra`): the three `query-insights*` datasets, 46 cases x 3
 * trials, run on 2026-11-06. Braintrust run:
 * https://www.braintrust.dev/app/mongodb-education-ai/p/agents-evals/experiments/query-insights%3Fmodel%3Dgpt-6.1-terra%26runId%3D1794002059553
 *
 * Re-run and update these when the Query Insights prompt, tools or model change.
 */
export const QUERY_INSIGHTS_BASELINE = {
  AnswerMatches: 1,
  NoForbiddenExecuted: 1,
  ReferenceCoverage: 0.75,
  ReportFactuality: 0.9481,
  ReportShape: 0.9926,
  SuggestedIndexUsage: 0.9778,
  ToolCallArgCoverage: 1,
} as const;

/**
 * `ToolCallCoverage` is not gated. It caps when the agent makes more than twice
 * the expected calls, and the agent investigates before the advisor call. No
 * value in the baseline run reached 1 (mean 0.31), so the score tracks extra
 * calls, not the report.
 */

/** How far below the baseline a run may fall before the validator fails. */
export const QUERY_INSIGHTS_MARGIN = 0.05;

function floorToHundredth(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

export const QUERY_INSIGHTS_THRESHOLDS: Readonly<Record<string, number>> =
  Object.fromEntries(
    Object.entries(QUERY_INSIGHTS_BASELINE).map(([name, mean]) => [
      name,
      floorToHundredth(mean - QUERY_INSIGHTS_MARGIN),
    ]),
  );
