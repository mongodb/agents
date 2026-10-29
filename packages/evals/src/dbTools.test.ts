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
import { loadAgentCasesFromFile, parseAgentCases } from "./cases.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import type { CustomInput } from "./schemas.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const DB_TOOLS_DATASET = path.join(
  import.meta.dirname,
  "..",
  "datasets",
  "db-tools.yml",
);

const READ_TOOLS = [
  "mongodb__aggregate",
  "mongodb__collection_indexes",
  "mongodb__collection_schema",
  "mongodb__collection_storage_size",
  "mongodb__count",
  "mongodb__db_stats",
  "mongodb__explain",
  "mongodb__find",
  "mongodb__list_collections",
  "mongodb__list_databases",
];

describe("db-tools dataset", () => {
  const cases = loadAgentCasesFromFile(DB_TOOLS_DATASET);
  const calledTools = (testCase: (typeof cases)[number]) =>
    (testCase.expected?.outputMessages ?? []).flatMap((message) =>
      message.role === "assistant-tool"
        ? message.toolCalls.map((call) => call.name)
        : [],
    );

  it("has the 27 read cases from the source suite", () => {
    expect(cases).toHaveLength(27);
  });

  it("has unique case names", () => {
    const names = cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers every read tool the source suite covers", () => {
    const covered = new Set(cases.flatMap(calledTools));
    expect([...covered].sort()).toEqual(READ_TOOLS);
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    "%s is a single question in read-only mode against sample-mflix",
    (_name, testCase) => {
      expect(testCase.input.messages).toHaveLength(1);
      expect(testCase.input.messages[0]?.role).toBe("user");
      expect(testCase.input.custom?.toolSetup).toEqual({
        localMongo: "sample-mflix",
      });
      expect(testCase.input.custom?.allowWrites).toBeUndefined();
      expect(calledTools(testCase).length).toBeGreaterThan(0);
      for (const name of calledTools(testCase)) {
        expect(READ_TOOLS).toContain(name);
      }
    },
  );

  it("names the database and collection each question is about", () => {
    for (const testCase of cases) {
      const custom = testCase.input.custom as CustomInput | undefined;
      expect(custom?.defaultData?.databaseName).toBe("sample_mflix");
    }
  });
});

// The ported cases have no `script`, so a scripted run needs cases of its own.
const SCRIPTED_CASES = `
- name: finds the 1999 movies
  input:
    messages:
      - { role: user, content: Find the movies in my database that were released in 1999. }
    custom:
      defaultData: { databaseName: sample_mflix, collectionName: movies }
      toolSetup: { localMongo: sample-mflix }
      script:
        - toolCalls:
            - name: mongodb__find
              args: { connectionId: preconfigured, database: sample_mflix, collection: movies, filter: { year: 1999 } }
        - text: The Matrix came out in 1999.
  expected:
    outputMessages:
      - { role: user }
      - role: assistant-tool
        toolCalls:
          - name: mongodb__find
            arguments:
              - { name: database, type: string, value: sample_mflix }
              - { name: collection, type: string, value: movies }
              - { name: filter, type: object, size: { gte: 1 } }
      - { role: tool }
      - { role: assistant }
`;

describe("db-tools through the CLI", () => {
  const provider = createLocalToolProvider({ excludeKnowledgeTools: true });

  beforeAll(async () => {
    await provider.start?.();
  });

  afterAll(async () => {
    await provider.stop?.();
  });

  it("scores a scripted run of the explorer", async () => {
    const { exitCode, braintrust } = await runEvalCliWithMockBraintrust(
      () =>
        buildEvalCli({
          toolProvider: provider,
          extraDatasets: {
            "db-tools-scripted": {
              description: "Test only",
              getCases: async () =>
                parseAgentCases(SCRIPTED_CASES, "db-tools-scripted"),
            },
          },
        }),
      [
        "evaluation",
        "run",
        "--task",
        "explorer",
        "--dataset",
        "db-tools-scripted",
        "--model",
        "scripted",
        "--scorer",
        "AgentTrajectory",
        "--task-concurrency",
        "1",
        "--trial-count",
        "1",
      ],
    );

    expect(exitCode).toBe(0);
    const scores = new Map(
      braintrust.rows.flatMap((row) =>
        Object.entries(
          (row as { scores?: Record<string, number | null> }).scores ?? {},
        ),
      ),
    );
    expect(scores.get("ToolCallCoverage")).toBe(1);
    expect(scores.get("ToolCallArgCoverage")).toBe(1);
  }, 120_000);
});
