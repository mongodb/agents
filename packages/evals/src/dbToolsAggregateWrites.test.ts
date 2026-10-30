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

import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildEvalCli } from "./cli.js";
import { loadAgentCasesFromFile } from "./cases.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import type { CustomExpected, CustomInput } from "./schemas.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const DATASET = path.join(
  import.meta.dirname,
  "..",
  "datasets",
  "db-tools-aggregate-writes.yml",
);

describe("db-tools-aggregate-writes dataset", () => {
  const cases = loadAgentCasesFromFile(DATASET);
  const byName = (name: string) => cases.find((c) => c.name === name);
  const customOf = (name: string) =>
    byName(name)?.input.custom as CustomInput | undefined;
  const expectedOf = (name: string) =>
    byName(name)?.expected?.custom as CustomExpected | undefined;

  it("has $out approved, $out rejected and $merge in read-only mode", () => {
    expect(cases.map((c) => c.name)).toEqual([
      "out aggregation in write mode, approved",
      "out aggregation in write mode, rejected",
      "merge aggregation in read-only mode",
    ]);
  });

  it("approves the $out and checks the new collection", () => {
    const name = "out aggregation in write mode, approved";
    expect(customOf(name)?.allowWrites).toBe(true);
    expect(customOf(name)?.approval).toBe("approve");
    expect(customOf(name)?.mongoCheck).toBe("movies-before-1950-copied-to-classic-movies");
    expect(expectedOf(name)?.expectApprovalFor).toEqual(["mongodb__aggregate"]);
  });

  it("rejects the $out and leaves the seed alone", () => {
    const name = "out aggregation in write mode, rejected";
    expect(customOf(name)?.approval).toBe("reject");
    expect(customOf(name)?.mongoCheck).toBe("seed-unchanged");
    expect(expectedOf(name)?.expectApprovalFor).toEqual(["mongodb__aggregate"]);
  });

  it("checks only the database for the read-only $merge", () => {
    const name = "merge aggregation in read-only mode";
    expect(customOf(name)?.allowWrites).toBeUndefined();
    expect(customOf(name)?.mongoCheck).toBe("seed-unchanged");
    expect(expectedOf(name)?.answerMatches).toBeUndefined();
  });
});

describe("db-tools-aggregate-writes through the CLI", () => {
  const provider = createLocalToolProvider({ excludeKnowledgeTools: true });

  beforeAll(async () => {
    await provider.start?.();
  });

  afterAll(async () => {
    await provider.stop?.();
  });

  it("passes every scripted case", async () => {
    const { exitCode, braintrust } = await runEvalCliWithMockBraintrust(
      () => buildEvalCli({ toolProvider: provider }),
      [
        "evaluation",
        "run",
        "--task",
        "explorer",
        "--dataset",
        "db-tools-aggregate-writes",
        "--model",
        "scripted",
        "--scorer",
        "AgentTrajectory",
        "ApprovalRequested",
        "MongoCheck",
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
    expect(byScore.get("MongoCheck")).toEqual([1, 1, 1]);
    expect(byScore.get("ApprovalRequested")).toEqual([1, 1]);
    expect(byScore.get("ToolCallArgCoverage")).toEqual([1, 1]);
  }, 300_000);
});
