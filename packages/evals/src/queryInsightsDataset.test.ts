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

import fs from "node:fs";
import path from "node:path";

import type { JudgeModelConfig } from "mongodb-assistant-eval/scorers";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { loadAgentCasesFromFile } from "./cases.js";
import { buildEvalCli } from "./cli.js";
import { AtlasFixtureSchema } from "./atlas/fixtures.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const FIXTURE_DIR = path.join(import.meta.dirname, "..", "fixtures", "atlas");
const DATASET = path.join(import.meta.dirname, "..", "datasets", "query-insights.yml");

interface CaseCustom {
  toolSetup: { mockAtlas: string };
}

interface CustomExpectedCase {
  queryInsights?: { reference: string };
}

interface ChoiceTool {
  function: { parameters: { properties: { choice: { enum: string[] } } } };
}

/** A judge that always picks the first choice its schema allows. */
function firstChoiceJudge(): JudgeModelConfig {
  const create = vi.fn(async (request: { tools: ChoiceTool[] }) => {
    const [choice] = request.tools[0].function.parameters.properties.choice.enum;
    return {
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "select_choice",
                  arguments: JSON.stringify({ rationale: "stub", choice }),
                },
              },
            ],
          },
        },
      ],
    };
  });
  return {
    modelId: "judge-model",
    client: { chat: { completions: { create } } },
    braintrustProxy: { apiKey: "k", endpoint: "e" },
  } as unknown as JudgeModelConfig;
}

describe("query-insights dataset", () => {
  const cases = loadAgentCasesFromFile(DATASET);

  it("has one case per ported source, each reading its own valid seed", () => {
    expect(cases).toHaveLength(19);
    for (const testCase of cases) {
      const { toolSetup } = testCase.input.custom as CaseCustom;
      const seedName = toolSetup.mockAtlas;
      expect(seedName, testCase.name).toBe(testCase.name);
      const seedFile = path.join(FIXTURE_DIR, `${seedName}.yml`);
      expect(fs.existsSync(seedFile), seedName).toBe(true);
      expect(() => AtlasFixtureSchema.parse(parse(fs.readFileSync(seedFile, "utf8")))).not.toThrow();
    }
  });

  it("keeps lifetime totals out of every reference", () => {
    for (const testCase of cases) {
      const { queryInsights } = testCase.expected.custom as CustomExpectedCase;
      const reference = queryInsights?.reference;
      expect(reference, testCase.name).toBeDefined();
      const withoutListNumbers = reference!.replace(/^\d+\. /gm, "");
      expect(withoutListNumbers, testCase.name).not.toMatch(/\d/);
    }
  });
});

describe("query-insights dataset, scripted run", () => {
  it("calls the Performance Advisor on every case and scores it", async () => {
    const provider = createLocalToolProvider();
    await provider.start?.();
    try {
      const { exitCode, braintrust } = await runEvalCliWithMockBraintrust(
        () => buildEvalCli({ toolProvider: provider, judge: firstChoiceJudge() }),
        [
          "evaluation",
          "run",
          "--task",
          "query-insights",
          "--dataset",
          "query-insights",
          "--model",
          "scripted",
          "--task-concurrency",
          "2",
          "--trial-count",
          "1",
        ],
      );

      expect(exitCode).toBe(0);
      const toolCoverage = braintrust.rows
        .map((row) => row.scores?.ToolCallCoverage)
        .filter((value) => value !== undefined);
      expect(toolCoverage).toHaveLength(19);
      expect(toolCoverage.filter((value) => value !== 1)).toEqual([]);
    } finally {
      await provider.stop?.();
    }
  }, 300_000);
});
