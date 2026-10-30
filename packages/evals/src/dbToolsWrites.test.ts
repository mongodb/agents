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
import type { CustomExpected, CustomInput } from "./schemas.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const DATASET = path.join(
  import.meta.dirname,
  "..",
  "datasets",
  "db-tools-writes.yml",
);

const OPERATIONS = ["delete", "drop", "update", "insert"];
const MODES = [
  "read-only mode",
  "write mode, rejected",
  "write mode, approved",
];

describe("db-tools-writes dataset", () => {
  const cases = loadAgentCasesFromFile(DATASET);

  it("has every operation in every mode", () => {
    expect(cases.map((c) => c.name).sort()).toEqual(
      OPERATIONS.flatMap((op) => MODES.map((mode) => `${op} in ${mode}`)).sort(),
    );
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    "%s checks the database and has a script",
    (_title, testCase) => {
      const name = testCase.name ?? "";
      const custom = testCase.input.custom as CustomInput | undefined;
      const expected = testCase.expected?.custom as CustomExpected | undefined;
      expect(custom?.toolSetup).toEqual({ localMongo: "sample-mflix" });
      expect(custom?.script?.length).toBeGreaterThan(0);
      if (name.endsWith("approved")) {
        expect(custom?.allowWrites).toBe(true);
        expect(custom?.approval).toBe("approve");
        expect(custom?.mongoCheck).not.toBe("seed-unchanged");
        expect(expected?.expectApprovalFor).toHaveLength(1);
      } else {
        expect(custom?.mongoCheck).toBe("seed-unchanged");
      }
      if (name.endsWith("rejected")) {
        expect(custom?.approval).toBe("reject");
        expect(expected?.forbiddenExecuted).toEqual(
          expected?.expectApprovalFor,
        );
      }
      if (name.endsWith("read-only mode")) {
        expect(custom?.allowWrites).toBeUndefined();
        expect(testCase.expected?.outputMessages?.map((m) => m.role)).toEqual([
          "user",
          "assistant",
        ]);
        expect(expected?.answerMatches).toBeUndefined();
      }
    },
  );

  it("counts before a filtered delete, an update and a drop", () => {
    for (const op of ["delete", "drop", "update"]) {
      const testCase = cases.find((c) => c.name === `${op} in write mode, approved`);
      const tools = (testCase?.expected?.outputMessages ?? []).flatMap((m) =>
        m.role === "assistant-tool" ? m.toolCalls.map((call) => call.name) : [],
      );
      expect(tools[0]).toBe("mongodb__count");
      expect(tools).toHaveLength(2);
    }
  });
});

describe("db-tools-writes through the CLI", () => {
  const provider = createLocalToolProvider({ excludeKnowledgeTools: true });

  beforeAll(async () => {
    await provider.start?.();
  });

  afterAll(async () => {
    await provider.stop?.();
  });

  it("passes every scripted case with every end-state check", async () => {
    const { exitCode, braintrust } = await runEvalCliWithMockBraintrust(
      () => buildEvalCli({ toolProvider: provider }),
      [
        "evaluation",
        "run",
        "--task",
        "explorer",
        "--dataset",
        "db-tools-writes",
        "--model",
        "scripted",
        "--scorer",
        "AgentTrajectory",
        "NoForbiddenExecuted",
        "ApprovalRequested",
        "MongoCheck",
        "ToolCallAmountCorrect",
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
    for (const [name, values] of byScore) {
      expect({ name, values: values.filter((v) => v !== 1) }).toEqual({
        name,
        values: [],
      });
    }
    expect(byScore.get("MongoCheck")).toHaveLength(12);
    expect(byScore.get("ToolCallAmountCorrect")).toHaveLength(4);
    expect(byScore.get("ApprovalRequested")).toHaveLength(8);
    expect(byScore.get("NoForbiddenExecuted")).toHaveLength(4);
  }, 300_000);
});
