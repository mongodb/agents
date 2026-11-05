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
 * Mean scores of the knowledge suite with the Atlas Explorer's production
 * model (`gpt-6-luna`) and the Grove judge: the `knowledge` dataset, 37 cases
 * x 5 trials, run on 2026-11-04. Braintrust run:
 * https://www.braintrust.dev/app/mongodb-education-ai/p/agents-evals/experiments/explorer%3Fmodel%3Dgpt-6-luna%26runId%3Dkg-base-5t
 *
 * `Factuality` (0.604) and `IsMercuryPass` (0.913) come from the same judge
 * call as `ReferenceAlignment` and are not gated.
 *
 * Re-run and update these when the Explorer's prompt, tools or judge change.
 * The agent calls the live `knowledge.mongodb.com` API, so a change there
 * moves them too: `BinaryNdcgAt5` read 0.17 on 2026-11-03 and 0.56 a few
 * hours later with the same code.
 */
export const KNOWLEDGE_EXPLORER_BASELINE = {
  /** The judge's grade against the reference answer, over all 37 cases. */
  ReferenceAlignment: 0.8641,
  /** Only the 22 cases that list `links`. */
  BinaryNdcgAt5: 0.563,
  ToolCallCoverage: 0.811,
} as const;

/** How far below the baseline a run may fall before the validator fails. */
export const KNOWLEDGE_EXPLORER_MARGIN = 0.05;

function floorToHundredth(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

export const KNOWLEDGE_EXPLORER_THRESHOLDS: Readonly<Record<string, number>> =
  Object.fromEntries(
    Object.entries(KNOWLEDGE_EXPLORER_BASELINE).map(([name, mean]) => [
      name,
      floorToHundredth(mean - KNOWLEDGE_EXPLORER_MARGIN),
    ]),
  );

/**
 * Mean scores of the knowledge suite with the Atlas Query Insights agent on
 * `gpt-6-luna` and the Grove judge: the `knowledge` dataset, 37 cases x 5
 * trials, run on 2026-11-04. Braintrust run:
 * https://www.braintrust.dev/app/mongodb-education-ai/p/agents-evals/experiments/query-insights%3Fmodel%3Dgpt-6-luna%26runId%3Dqi-luna-kg-base-5t
 *
 * This is not the agent's production model (`gpt-6.1-terra`). The Grove
 * gateway that CI uses does not support terra yet, so the Query Insights
 * eval scripts run luna in the meantime. Re-baseline on terra when the
 * gateway adds it. A terra run on plain OpenAI gave `ReferenceAlignment`
 * 0.861, `BinaryNdcgAt5` 0.599 and `ToolCallCoverage` 0.665.
 *
 * Explorer's thresholds fit these means, but the agents differ, so each has
 * its own baseline. `Factuality` (0.595) and `IsMercuryPass` (0.863) are not
 * gated, as for the Explorer.
 *
 * Re-run and update these when the agent's prompt, tools or judge change,
 * or when `BinaryNdcgAt5` moves for no code reason (see the Explorer note).
 */
export const KNOWLEDGE_QUERY_INSIGHTS_BASELINE = {
  /** The judge's grade against the reference answer, over all 37 cases. */
  ReferenceAlignment: 0.8601,
  /** Only the 22 cases that list `links`. */
  BinaryNdcgAt5: 0.537,
  ToolCallCoverage: 0.7621,
} as const;

export const KNOWLEDGE_QUERY_INSIGHTS_THRESHOLDS: Readonly<
  Record<string, number>
> = Object.fromEntries(
  Object.entries(KNOWLEDGE_QUERY_INSIGHTS_BASELINE).map(([name, mean]) => [
    name,
    floorToHundredth(mean - KNOWLEDGE_EXPLORER_MARGIN),
  ]),
);
