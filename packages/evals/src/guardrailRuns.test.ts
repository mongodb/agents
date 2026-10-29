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

import { GUARDRAIL_REFUSAL_MESSAGE } from "@repo/agent-engine-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildEvalCli, type EvalCliOptions } from "./cli.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const provider = createLocalToolProvider();

beforeAll(async () => {
  await provider.start?.();
});

afterAll(async () => {
  await provider.stop?.();
});

/**
 * The datasets keep scripts out of the YAML, so a real model can run them.
 * This gives each case without a script the reply a correct agent gives:
 * the canonical refusal for a reject case, a plain answer otherwise.
 */
const withScripts: NonNullable<EvalCliOptions["mapCases"]> = (cases) =>
  cases.map((c) => {
    const custom = c.input.custom as { script?: unknown } | undefined;
    if (custom?.script) return c;
    const text = c.expected.guardrail?.reject
      ? GUARDRAIL_REFUSAL_MESSAGE
      : "Here is a plain answer about MongoDB.";
    return {
      ...c,
      input: { ...c.input, custom: { ...custom, script: [{ text }] } },
    };
  });

const DATASETS = {
  explorer: [
    "input-guardrail",
    "prompt-injection",
    "prompt-injection-tool-output-explorer",
  ],
  "query-insights": [
    "input-guardrail",
    "prompt-injection",
    "prompt-injection-tool-output-query-insights",
  ],
};

async function scoresOf(task: keyof typeof DATASETS) {
  const { exitCode, braintrust } = await runEvalCliWithMockBraintrust(
    () => buildEvalCli({ toolProvider: provider, mapCases: withScripts }),
    [
      "evaluation",
      "run",
      "--task",
      task,
      "--dataset",
      ...DATASETS[task],
      "--model",
      "scripted",
      "--task-concurrency",
      "2",
      "--trial-count",
      "1",
    ],
  );
  const perRow = new Map<string, Record<string, number | null>>();
  for (const row of braintrust.rows) {
    if (!row.scores || !row.id) continue;
    perRow.set(row.id, { ...perRow.get(row.id), ...row.scores });
  }
  const byName = new Map<string, number[]>();
  for (const scores of perRow.values()) {
    for (const [name, value] of Object.entries(scores)) {
      if (value === null) continue;
      byName.set(name, [...(byName.get(name) ?? []), value]);
    }
  }
  return { exitCode, byName };
}

describe.each(["explorer", "query-insights"] as const)(
  "guardrail datasets, scripted %s run",
  (task) => {
    it("scores every guardrail check 1", async () => {
      const { exitCode, byName } = await scoresOf(task);
      expect(exitCode).toBe(0);
      // 26 + 5 + 2 cases carry a guardrail label, minus the one skipped case.
      // The 12 + 5 reject cases carry the zero-tool check.
      expect(byName.get("QueryRefusalMatch")).toHaveLength(32);
      expect(byName.get("ToolCallAmountCorrect")).toHaveLength(17);
      expect(byName.get("AnswerMatches")?.length).toBeGreaterThanOrEqual(7);
      for (const name of [
        "QueryRefusalMatch",
        "ToolCallAmountCorrect",
        "AnswerMatches",
      ]) {
        expect(
          byName.get(name)?.every((score) => score === 1),
          `${name} is 1 on every case`,
        ).toBe(true);
      }
    }, 240_000);
  },
);
