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

import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { JudgeModelConfig } from "mongodb-assistant-eval/scorers";

import { judgeModelConfig } from "./judge.js";
import { judgeChoice, makeQueryInsightsJudges } from "./queryInsightsJudges.js";
import type { CustomExpected } from "./schemas.js";

type Scorer = ReturnType<typeof makeQueryInsightsJudges>["ReportFactuality"];
type Args = Parameters<Scorer>[0];

/** A judge client that answers every call with `verdict` as its tool call. */
function stubJudge(verdict: unknown) {
  const create = vi.fn(async (_request: Record<string, unknown>) => ({
    choices: [
      {
        message: {
          tool_calls:
            verdict === undefined
              ? undefined
              : [
                  {
                    type: "function",
                    function: { name: "select_choice", arguments: JSON.stringify(verdict) },
                  },
                ],
        },
      },
    ],
  }));
  const judge = {
    modelId: "judge-model",
    client: { chat: { completions: { create } } },
    braintrustProxy: { apiKey: "k", endpoint: "e" },
  } as unknown as JudgeModelConfig;
  return { judge, create };
}

function args(queryInsights: CustomExpected["queryInsights"] | null): Args {
  return {
    input: { messages: [{ role: "user", content: "Why are my queries slow?" }] },
    expected: { custom: queryInsights ? { queryInsights } : undefined },
    output: {
      messages: [
        { role: "user", content: "Why are my queries slow?" },
        { role: "assistant", content: "" },
        {
          role: "tool",
          name: "mongodb__atlas_get_performance_advisor",
          content: '## Slow Query Logs\n[{"line":"{\\"docsExamined\\":20000}"}]',
        },
        { role: "assistant", content: "The query examined 20,000 documents." },
      ],
      assistantMessageContent: "The query examined 20,000 documents.",
      allowedQuery: true,
    },
  } as unknown as Args;
}

const WITH_REFERENCE = {
  suggestedIndexes: [],
  reference: "Areas worth investigating:\n1. The query scans the whole collection.",
};

describe("judgeChoice", () => {
  it("forces the select_choice tool with only the allowed choices", async () => {
    const { judge, create } = stubJudge({ rationale: "fine", choice: "B" });

    await expect(judgeChoice(judge, "grade this", ["A", "B"])).resolves.toEqual({
      choice: "B",
      rationale: "fine",
    });
    const request = create.mock.calls[0][0] as {
      model: string;
      tools: { function: { parameters: { properties: { choice: unknown } } } }[];
      tool_choice: unknown;
    };
    expect(request.model).toBe("judge-model");
    expect(request.tool_choice).toEqual({
      type: "function",
      function: { name: "select_choice" },
    });
    expect(request.tools[0].function.parameters.properties.choice).toEqual({
      type: "string",
      enum: ["A", "B"],
    });
  });

  it("throws on a missing verdict or an unknown choice", async () => {
    await expect(judgeChoice(stubJudge(undefined).judge, "p", ["A"])).rejects.toThrow(
      "The judge returned no verdict",
    );
    await expect(
      judgeChoice(stubJudge({ rationale: "", choice: "C" }).judge, "p", ["A"]),
    ).rejects.toThrow("The judge returned an unknown choice: C");
  });
});

describe("ReportFactuality", () => {
  it("grades the report against the tool output", async () => {
    const { judge, create } = stubJudge({ rationale: "Criterion 2.", choice: "0.5" });
    const { ReportFactuality } = makeQueryInsightsJudges(judge);

    await expect(ReportFactuality(args(WITH_REFERENCE))).resolves.toEqual({
      name: "ReportFactuality",
      score: 0.5,
      metadata: { choice: "0.5", rationale: "Criterion 2." },
    });
    const prompt = (create.mock.calls[0][0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(prompt).toContain("[User Request]\nWhy are my queries slow?");
    expect(prompt).toContain(
      '[Tool Output]\n[mongodb__atlas_get_performance_advisor]\n## Slow Query Logs',
    );
    expect(prompt).toContain("[Report]\nThe query examined 20,000 documents.");
    expect(prompt).toContain("(CONTRADICTS_INPUT)");
    expect(prompt).not.toContain("Expert Reference");
  });

  it("does not run, or call the judge, without Query Insights expectations", async () => {
    const { judge, create } = stubJudge({ rationale: "", choice: "1.0" });
    const { ReportFactuality } = makeQueryInsightsJudges(judge);

    await expect(ReportFactuality(args(null))).resolves.toEqual({
      name: "ReportFactuality",
      score: null,
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("ReferenceCoverage", () => {
  it("grades the report against the case's reference", async () => {
    const { judge, create } = stubJudge({ rationale: "Same cause.", choice: "MOSTLY_ALIGNED" });
    const { ReferenceCoverage } = makeQueryInsightsJudges(judge);

    await expect(ReferenceCoverage(args(WITH_REFERENCE))).resolves.toEqual({
      name: "ReferenceCoverage",
      score: 0.75,
      metadata: { choice: "MOSTLY_ALIGNED", rationale: "Same cause." },
    });
    const prompt = (create.mock.calls[0][0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(prompt).toContain(
      "[Expert Reference]\nAreas worth investigating:\n1. The query scans the whole collection.",
    );
    expect(prompt).not.toContain("[Tool Output]");
  });

  it("does not run on a case with no reference", async () => {
    const { judge, create } = stubJudge({ rationale: "", choice: "EQUIVALENT" });
    const { ReferenceCoverage } = makeQueryInsightsJudges(judge);

    await expect(ReferenceCoverage(args({ suggestedIndexes: [] }))).resolves.toEqual({
      name: "ReferenceCoverage",
      score: null,
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("the Query Insights judges with the judge config", () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  /** A stand-in for the Grove gateway that always picks one choice. */
  async function startFakeGateway(choice: string) {
    const requests: Record<string, unknown>[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({
          url: req.url,
          apiKey: req.headers["api-key"],
          authorization: req.headers.authorization,
          body: JSON.parse(body),
        });
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: "chatcmpl-1",
            object: "chat.completion",
            created: 0,
            model: "gpt-6-luna",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "select_choice",
                        arguments: JSON.stringify({ rationale: "ok", choice }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    stop = () => server.close();
    return {
      requests,
      port: (server.address() as AddressInfo).port,
    };
  }

  it("reaches the judge model through the Grove gateway the evals share", async () => {
    const gateway = await startFakeGateway("MOSTLY_ALIGNED");
    const judge = judgeModelConfig(
      {},
      {
        OPENAI_API_KEY: "grove-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${gateway.port}/grove-foundry/v1`,
      },
    );
    const { ReferenceCoverage } = makeQueryInsightsJudges(judge);

    await expect(ReferenceCoverage(args(WITH_REFERENCE))).resolves.toMatchObject({
      name: "ReferenceCoverage",
      score: 0.75,
    });
    expect(gateway.requests).toHaveLength(1);
    const [request] = gateway.requests;
    expect(request).toMatchObject({
      url: "/grove-foundry/v1/chat/completions",
      apiKey: "grove-key",
      body: {
        model: "gpt-6-luna",
        reasoning_effort: "none",
        tool_choice: { type: "function", function: { name: "select_choice" } },
      },
    });
  });
});
