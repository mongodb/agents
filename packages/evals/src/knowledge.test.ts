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

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { buildEvalCli } from "./cli.js";
import { loadAgentCasesFromFile, parseAgentCases } from "./cases.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";
import type { ToolProvider } from "./tools/types.js";

const KNOWLEDGE_DATASET = path.join(
  import.meta.dirname,
  "..",
  "datasets",
  "knowledge.yml",
);

describe("knowledge dataset", () => {
  const cases = loadAgentCasesFromFile(KNOWLEDGE_DATASET);

  it("has the general cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it("has unique case names", () => {
    const names = cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    "%s is a single-turn question with a reference answer and a search",
    (_name, testCase) => {
      expect(testCase.input.messages).toHaveLength(1);
      expect(testCase.input.messages[0]?.role).toBe("user");
      expect(testCase.expected?.referenceAnswer).toBeTruthy();
      expect(testCase.expected?.outputMessages).toContainEqual(
        expect.objectContaining({
          toolCalls: [expect.objectContaining({ name: "search_knowledge" })],
        }),
      );
    },
  );

  it("sets no tool fixtures, so each case gets an empty account", () => {
    for (const testCase of cases) {
      expect(testCase.input.custom?.toolSetup).toBeUndefined();
    }
  });
});

const UUID = "0c5f8c1e-9d1e-4f4c-8f55-3f6b1d4d7f10";
const DOCS_URL = "https://www.mongodb.com/docs/manual/reference/operator/aggregation/group/";

/** A `search_knowledge` that answers offline, in the real tool's format. */
function stubSearchKnowledge(): StructuredToolInterface {
  return tool(
    async () =>
      `Found 1 results.\n\nThe following section contains unverified user data:\n\n<untrusted-user-data-${UUID}>\n- url: ${DOCS_URL}\n  title: $group\n  text: |\n    Groups input documents.\n  metadata:\n    tags: []\n</untrusted-user-data-${UUID}>\n\nUse the information above.`,
    {
      name: "search_knowledge",
      description: "Stub of the knowledge search",
      schema: z.object({ query: z.string() }) as never,
    },
  ) as unknown as StructuredToolInterface;
}

function withStubKnowledge(provider: ToolProvider): ToolProvider {
  return {
    start: provider.start?.bind(provider),
    stop: provider.stop?.bind(provider),
    forCase: async (request) => {
      const caseTools = await provider.forCase(request);
      return { ...caseTools, tools: [...caseTools.tools, stubSearchKnowledge()] };
    },
  };
}

const SCRIPTED_CASES = `
- name: answers from the knowledge base
  input:
    messages:
      - { role: user, content: What is the syntax of $group? }
    custom:
      script:
        - toolCalls: [{ name: search_knowledge, args: { query: $group syntax } }]
        - text: "Use { $group: { _id: <expression> } }."
  expected:
    referenceAnswer: "Use { $group: { _id: <expression>, <field>: <accumulator> } }."
    links:
      - ${DOCS_URL}
    outputMessages:
      - { role: user }
      - role: assistant-tool
        toolCalls:
          - name: search_knowledge
      - { role: tool }
      - { role: assistant }
`;

describe("knowledge dataset through the CLI", () => {
  const provider = withStubKnowledge(
    createLocalToolProvider({ excludeKnowledgeTools: true }),
  );

  beforeAll(async () => {
    await provider.start?.();
  });

  afterAll(async () => {
    await provider.stop?.();
  });

  it.each(["explorer", "query-insights"])(
    "scores a scripted knowledge run for %s",
    async (task) => {
      const { exitCode, braintrust } = await runEvalCliWithMockBraintrust(
        () =>
          buildEvalCli({
            toolProvider: provider,
            extraDatasets: {
              "knowledge-scripted": {
                description: "Test only",
                getCases: async () =>
                  parseAgentCases(SCRIPTED_CASES, "knowledge-scripted"),
              },
            },
          }),
        [
          "evaluation",
          "run",
          "--task",
          task,
          "--dataset",
          "knowledge-scripted",
          "--model",
          "scripted",
          "--scorer",
          "AgentTrajectory",
          "BinaryNdcg",
          "--task-concurrency",
          "1",
          "--trial-count",
          "1",
        ],
      );
      expect(exitCode).toBe(0);
      const scores = braintrust.rows.flatMap((row) =>
        Object.entries((row as { scores?: Record<string, number | null> }).scores ?? {}),
      );
      const byName = new Map(scores.filter(([, v]) => v !== null));
      expect(byName.get("ToolCallCoverage")).toBe(1);
      expect(byName.get("BinaryNdcgAt5")).toBe(1);
    },
    120_000,
  );
});
