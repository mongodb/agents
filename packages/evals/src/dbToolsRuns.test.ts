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

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildEvalCli } from "./cli.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const PACKAGE_JSON = path.join(import.meta.dirname, "..", "package.json");
const DATASET_DIR = path.join(import.meta.dirname, "..", "datasets");

/** `db-tools` is the ported read suite. It has no scripts, so it needs a real model. */
const SCRIPTED = [
  "db-tools-writes",
  "db-tools-aggregate-writes",
  "db-tools-injection",
];

function packageScript(): string[] {
  const scripts = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")).scripts;
  return String(scripts["eval:db-tools:explorer"]).split(/\s+/);
}

function datasetsIn(args: string[]): string[] {
  const start = args.indexOf("--dataset") + 1;
  const end = args.findIndex((arg, i) => i >= start && arg.startsWith("--"));
  return args.slice(start, end === -1 ? undefined : end);
}

describe("eval:db-tools:explorer script", () => {
  const args = packageScript();

  it("runs every db-tools dataset", () => {
    const shipped = fs
      .readdirSync(DATASET_DIR)
      .filter((file) => /^db-tools.*\.yml$/.test(file))
      .map((file) => file.replace(/\.yml$/, ""));
    expect(datasetsIn(args).sort()).toEqual(shipped.sort());
  });

  it("runs the Explorer with the production model and 3 trials", () => {
    expect(args).toContain("explorer");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-6-luna");
    expect(args[args.indexOf("--trial-count") + 1]).toBe("3");
    expect(args[args.indexOf("--validate") + 1]).toBe("db-tools-explorer");
    expect(args[args.indexOf("--task-concurrency") + 1]).toBe("2");
  });
});

describe("db-tools datasets, scripted explorer run", () => {
  const provider = createLocalToolProvider({ excludeKnowledgeTools: true });

  beforeAll(async () => {
    await provider.start?.();
  });

  afterAll(async () => {
    await provider.stop?.();
  });

  it("scores every scripted case 1 on every score", async () => {
    const { exitCode, braintrust } = await runEvalCliWithMockBraintrust(
      () => buildEvalCli({ toolProvider: provider }),
      [
        "evaluation",
        "run",
        "--task",
        "explorer",
        "--dataset",
        ...SCRIPTED,
        "--model",
        "scripted",
        "--validate",
        "db-tools-explorer",
        "--task-concurrency",
        "2",
        "--trial-count",
        "1",
      ],
    );

    expect(exitCode).toBe(0);
    const byScore = new Map<string, number[]>();
    for (const row of braintrust.rows) {
      for (const [name, value] of Object.entries(
        (row as { scores?: Record<string, number | null> }).scores ?? {},
      )) {
        if (value !== null) byScore.set(name, [...(byScore.get(name) ?? []), value]);
      }
    }
    expect([...byScore.keys()].sort()).toEqual(
      expect.arrayContaining([
        "AnswerMatches",
        "ApprovalRequested",
        "MongoCheck",
        "NoForbiddenExecuted",
        "ToolCallAmountCorrect",
        "ToolCallArgCoverage",
        "ToolCallCoverage",
      ]),
    );
    expect(byScore.get("MongoCheck")).toHaveLength(12 + 3 + 8);
    for (const [name, values] of byScore) {
      expect({ name, misses: values.filter((v) => v !== 1) }).toEqual({
        name,
        misses: [],
      });
    }
  }, 600_000);
});
