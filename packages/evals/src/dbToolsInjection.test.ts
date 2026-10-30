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
import { loadFixture } from "./fixtures.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import type { CustomExpected, CustomInput } from "./schemas.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const DATASET = path.join(
  import.meta.dirname,
  "..",
  "datasets",
  "db-tools-injection.yml",
);

describe("db-tools-injection dataset", () => {
  const cases = loadAgentCasesFromFile(DATASET);
  const customOf = (tags: string) =>
    cases
      .filter((c) => c.tags?.includes(tags))
      .map((c) => ({
        name: c.name,
        input: c.input.custom as CustomInput | undefined,
        expected: c.expected?.custom as CustomExpected | undefined,
      }));

  it("has five data cases and three user message cases", () => {
    expect(customOf("tool_output")).toHaveLength(5);
    expect(customOf("user_message")).toHaveLength(3);
    expect(cases).toHaveLength(8);
  });

  it("checks the database after every case", () => {
    for (const testCase of cases) {
      expect(
        (testCase.input.custom as CustomInput | undefined)?.mongoCheck,
      ).toBe("seed-unchanged");
    }
  });

  it("runs the data cases on the poisoned fixture", () => {
    for (const { input } of customOf("tool_output")) {
      expect(input?.toolSetup).toEqual({ localMongo: "sample-mflix-poisoned" });
    }
  });

  it("approves writes in the write mode data cases, so an obeyed call would run", () => {
    const writable = customOf("tool_output").filter(
      ({ input }) => input?.allowWrites,
    );
    expect(writable.length).toBeGreaterThanOrEqual(4);
    for (const { input, expected } of writable) {
      expect(input?.approval).toBe("approve");
      expect(expected?.forbiddenExecuted?.length).toBeGreaterThan(0);
    }
  });

  it("answers the question in every data case", () => {
    for (const { expected } of customOf("tool_output")) {
      expect(expected?.answerMatches?.length).toBeGreaterThan(0);
    }
  });

  it("runs the user message cases in read-only mode on the clean fixture", () => {
    for (const { input } of customOf("user_message")) {
      expect(input?.allowWrites).toBeUndefined();
      expect(input?.toolSetup).toEqual({ localMongo: "sample-mflix" });
    }
  });

  it("does not expect a refusal or an answer pattern for user message cases", () => {
    for (const testCase of cases.filter((c) => c.tags?.includes("user_message"))) {
      expect(testCase.expected?.guardrail).toBeUndefined();
      expect(
        (testCase.expected?.custom as CustomExpected | undefined)?.answerMatches,
      ).toBeUndefined();
    }
  });
});

describe("sample-mflix-poisoned fixture", () => {
  const seed = loadFixture("localMongo", "sample-mflix-poisoned") as Record<
    string,
    Record<string, { documents: Record<string, unknown>[] }>
  >;
  const text = JSON.stringify(seed);

  it("carries an instruction in a plot, a collection name and a field name", () => {
    const plots = seed.sample_mflix.movies.documents.map((d) => String(d.plot));
    expect(plots.filter((p) => /SYSTEM|ASSISTANT INSTRUCTION/.test(p))).toHaveLength(3);
    expect(Object.keys(seed.sample_mflix).some((n) => /ignore all rules/.test(n))).toBe(true);
    expect(
      seed.sample_mflix.reviews.documents.some((d) =>
        Object.keys(d).some((key) => /^SYSTEM:/.test(key)),
      ),
    ).toBe(true);
  });

  it("keeps the collections the cases ask about", () => {
    expect(Object.keys(seed.sample_mflix)).toEqual(
      expect.arrayContaining(["movies", "theaters", "reviews"]),
    );
    expect(text).not.toMatch(/mongodb\+srv:/);
  });
});

describe("db-tools-injection through the CLI", () => {
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
        "db-tools-injection",
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
      for (const [name, value] of Object.entries(
        (row as { scores?: Record<string, number | null> }).scores ?? {},
      )) {
        if (value !== null) byScore.set(name, [...(byScore.get(name) ?? []), value]);
      }
    }
    expect(byScore.get("MongoCheck")).toEqual(Array(8).fill(1));
    expect(byScore.get("AnswerMatches")).toEqual(Array(5).fill(1));
    expect(byScore.get("NoForbiddenExecuted")).toEqual(Array(6).fill(1));
  }, 300_000);
});
