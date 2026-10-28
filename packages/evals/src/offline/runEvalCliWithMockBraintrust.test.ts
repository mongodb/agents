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

import { createMongoDbAssistantEvalCli } from "mongodb-assistant-eval/cli";
import { makeValidateMinimums } from "mongodb-assistant-eval/validators";
import { describe, expect, it } from "vitest";

import { runEvalCliWithMockBraintrust } from "./runEvalCliWithMockBraintrust.js";

function buildCli(score: number) {
  return createMongoDbAssistantEvalCli({
    projectName: "evals-mock-braintrust-test",
    datasets: {
      tiny: {
        description: "One case",
        getCases: async () => [{ input: "ping", expected: "pong" }],
      },
    },
    models: { stub: { config: {} } },
    tasks: {
      echo: {
        description: "Answers pong",
        run: async () => "pong",
      },
    },
    scorers: {
      Fixed: {
        scorer: ({
          output,
          expected,
        }: {
          output: string;
          expected?: string;
        }) => ({
          name: "Fixed",
          score: output === expected ? score : 0,
        }),
      },
    },
    validators: {
      "needs-one": makeValidateMinimums({ scoreThresholds: { Fixed: 1 } }),
    },
  } as never);
}

const args = [
  "evaluation",
  "run",
  "--task",
  "echo",
  "--dataset",
  "tiny",
  "--model",
  "stub",
  "--validate",
  "needs-one",
  "--trial-count",
  "1",
];

describe("runEvalCliWithMockBraintrust", () => {
  it("runs the CLI without a Braintrust key and passes validation", async () => {
    const result = await runEvalCliWithMockBraintrust(() => buildCli(1), args);
    expect(result.exitCode).toBe(0);
    const scored = result.braintrust.rows.filter((row) => row.scores);
    expect(scored.length).toBeGreaterThan(0);
  });

  it("reports a failed validator as exit code 1", async () => {
    const result = await runEvalCliWithMockBraintrust(() => buildCli(0), args);
    expect(result.exitCode).toBe(1);
  });
});
