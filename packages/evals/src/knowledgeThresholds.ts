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
 * model (`gpt-6-luna`): the `knowledge` dataset, 37 cases x 5 trials, run on
 * 2026-11-03. Braintrust run:
 * https://www.braintrust.dev/app/mongodb-education-ai/p/agents-evals/experiments/explorer%3Fmodel%3Dgpt-6-luna%26runId%3Dk-base-5t
 *
 * `Factuality` (0.503) and `IsMercuryPass` (0.773) come from the same judge
 * call as `ReferenceAlignment` and are not gated.
 *
 * Re-run and update these when the Explorer's prompt, tools or judge change.
 * The agent calls the live `knowledge.mongodb.com` API, so a docs change can
 * move them too.
 */
export const KNOWLEDGE_EXPLORER_BASELINE = {
  /** The judge's grade against the reference answer, over all 37 cases. */
  ReferenceAlignment: 0.723,
  /**
   * Only the 22 cases that list `links`. The live search rarely returns the
   * expected URLs, so this is low.
   */
  BinaryNdcgAt5: 0.1685,
  ToolCallCoverage: 0.6643,
} as const;

/** How far below the baseline a run may fall before the validator fails. */
export const KNOWLEDGE_DEFAULT_MARGIN = 0.05;

/**
 * Margins that differ from the default. `ReferenceAlignment` depends on a
 * judge and is lumpy (its grades jump from 0.4 to 0.75 and 0.6 to 0.9), so a
 * 3-trial run moves by about 0.023 (one standard deviation). 0.05 would fail
 * about 1.7% of unchanged runs, 0.07 about 0.2%.
 */
export const KNOWLEDGE_EXPLORER_MARGINS: Readonly<Record<string, number>> = {
  ReferenceAlignment: 0.07,
};

function floorToHundredth(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

export const KNOWLEDGE_EXPLORER_THRESHOLDS: Readonly<Record<string, number>> =
  Object.fromEntries(
    Object.entries(KNOWLEDGE_EXPLORER_BASELINE).map(([name, mean]) => [
      name,
      floorToHundredth(
        mean - (KNOWLEDGE_EXPLORER_MARGINS[name] ?? KNOWLEDGE_DEFAULT_MARGIN),
      ),
    ]),
  );
