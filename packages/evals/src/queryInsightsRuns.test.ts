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

import { describe, expect, it } from "vitest";

import { buildEvalCli } from "./cli.js";
import { firstChoiceJudge } from "./offline/firstChoiceJudge.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import { QUERY_INSIGHTS_THRESHOLDS } from "./queryInsightsThresholds.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const PACKAGE_JSON = path.join(import.meta.dirname, "..", "package.json");
const DATASET_DIR = path.join(import.meta.dirname, "..", "datasets");

/** The smoke dataset has its own script, so the report suite leaves it out. */
const SUITE = /^query-insights.*\.yml$/;
const SMOKE = "query-insights-smoke";

/** The report cases: the ported set, the user prompts and the injection cases. */
const SCRIPTED_DATASETS = ["query-insights", "query-insights-realistic-user-queries", "query-insights-injection"];

function packageScript(): string[] {
  const scripts = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")).scripts;
  return String(scripts["eval:query-insights"]).split(/\s+/);
}

function datasetsIn(args: string[]): string[] {
  const start = args.indexOf("--dataset") + 1;
  const end = args.findIndex((arg, i) => i >= start && arg.startsWith("--"));
  return args.slice(start, end === -1 ? undefined : end);
}

describe("eval:query-insights script", () => {
  const args = packageScript();

  it("runs every report dataset", () => {
    const shipped = fs
      .readdirSync(DATASET_DIR)
      .filter((file) => SUITE.test(file))
      .map((file) => file.replace(/\.yml$/, ""))
      .filter((name) => name !== SMOKE);
    expect(datasetsIn(args).sort()).toEqual(shipped.sort());
  });

  it("runs the Query Insights agent with gpt-6-luna and 3 trials", () => {
    expect(args[args.indexOf("--task") + 1]).toBe("query-insights");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-6-luna");
    expect(args[args.indexOf("--trial-count") + 1]).toBe("3");
    expect(args[args.indexOf("--task-concurrency") + 1]).toBe("8");
    expect(args[args.indexOf("--validate") + 1]).toBe("query-insights");
  });
});

describe("query-insights report datasets, scripted run", () => {
  it("scores every scripted case without a forbidden call or a missed answer", async () => {
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
          ...SCRIPTED_DATASETS,
          "--model",
          "scripted",
          "--task-concurrency",
          "2",
          "--trial-count",
          "1",
        ],
      );

      expect(exitCode).toBe(0);
      const byScore = new Map<string, number[]>();
      for (const row of braintrust.rows) {
        for (const [name, value] of Object.entries(row.scores ?? {})) {
          if (value !== null) byScore.set(name, [...(byScore.get(name) ?? []), value]);
        }
      }
      expect(byScore.get("ToolCallCoverage")).toHaveLength(40);
      expect([...byScore.keys()]).toEqual(
        expect.arrayContaining(Object.keys(QUERY_INSIGHTS_THRESHOLDS)),
      );
      for (const name of ["ToolCallCoverage", "AnswerMatches", "NoForbiddenExecuted"]) {
        expect({ name, misses: (byScore.get(name) ?? []).filter((v) => v !== 1) }).toEqual({
          name,
          misses: [],
        });
      }
    } finally {
      await provider.stop?.();
    }
  }, 600_000);
});
