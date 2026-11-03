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

import { makeFactuality } from "mongodb-assistant-eval/scorers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_JUDGE_ENDPOINT,
  DEFAULT_JUDGE_MODEL,
  judgeModelConfig,
} from "./judge.js";

const GROVE_URL = "https://grove-foundry.example.com/v1";

describe("judgeModelConfig", () => {
  it("uses gpt-6-luna through the Grove gateway from OPENAI_BASE_URL", () => {
    const judge = judgeModelConfig(
      {},
      { OPENAI_API_KEY: "grove-key", OPENAI_BASE_URL: `${GROVE_URL}/chat` },
    );
    expect(judge.modelId).toBe("gpt-6-luna");
    expect(judge.modelId).toBe(DEFAULT_JUDGE_MODEL);
    expect(judge.client.baseURL).toBe(GROVE_URL);
    expect(judge.braintrustProxy).toEqual({
      apiKey: "grove-key",
      endpoint: GROVE_URL,
    });
  });

  it("sends the Grove key in an api-key header", async () => {
    const requests: Record<string, string | string[] | undefined>[] = [];
    const server = http.createServer((req, res) => {
      requests.push(req.headers);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [] }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const port = (server.address() as AddressInfo).port;
      const judge = judgeModelConfig(
        {},
        {
          OPENAI_API_KEY: "grove-key",
          OPENAI_BASE_URL: `http://127.0.0.1:${port}/grove-foundry/v1`,
        },
      );
      await judge.client.models.list();
      expect(requests[0]?.["api-key"]).toBe("grove-key");
    } finally {
      server.close();
    }
  });

  it("falls back to the OpenAI endpoint when none is configured", () => {
    const judge = judgeModelConfig({}, { OPENAI_API_KEY: "sk-test" });
    expect(judge.client.baseURL).toBe(DEFAULT_JUDGE_ENDPOINT);
    expect(judge.braintrustProxy).toEqual({
      apiKey: "sk-test",
      endpoint: DEFAULT_JUDGE_ENDPOINT,
    });
  });

  it("ignores BRAINTRUST_API_KEY, which Grove would reject", () => {
    const judge = judgeModelConfig(
      {},
      { BRAINTRUST_API_KEY: "braintrust-key", OPENAI_BASE_URL: GROVE_URL },
    );
    expect(() => judge.client).toThrow(/needs an API key/);
  });

  it("points at any OpenAI-compatible endpoint", () => {
    const judge = judgeModelConfig(
      { model: "another-judge", endpoint: "https://llm.example/v1" },
      { OPENAI_API_KEY: "key" },
    );
    expect(judge.modelId).toBe("another-judge");
    expect(judge.client.baseURL).toBe("https://llm.example/v1");
    expect(judge.braintrustProxy).toEqual({
      apiKey: "key",
      endpoint: "https://llm.example/v1",
    });
  });

  it("prefers the options, then the EVAL_JUDGE variables", () => {
    const env = {
      OPENAI_API_KEY: "openai-key",
      OPENAI_BASE_URL: GROVE_URL,
      EVAL_JUDGE_API_KEY: "eval-key",
      EVAL_JUDGE_MODEL: "env-judge",
      EVAL_JUDGE_ENDPOINT: "http://localhost:1/v1",
    };
    const fromEnv = judgeModelConfig({}, env);
    expect(fromEnv.modelId).toBe("env-judge");
    expect(fromEnv.braintrustProxy).toEqual({
      apiKey: "eval-key",
      endpoint: "http://localhost:1/v1",
    });

    const fromOptions = judgeModelConfig(
      { model: "option-judge", apiKey: "option-key", endpoint: "http://x/v1" },
      env,
    );
    expect(fromOptions.modelId).toBe("option-judge");
    expect(fromOptions.braintrustProxy).toEqual({
      apiKey: "option-key",
      endpoint: "http://x/v1",
    });
  });

  it("builds without a key and fails clearly when the judge is used", () => {
    const judge = judgeModelConfig({}, {});
    expect(judge.modelId).toBe("gpt-6-luna");
    expect(() => judge.client).toThrow(/needs an API key/);
    expect(() => judge.braintrustProxy).toThrow(/needs an API key/);
  });
});

interface JudgeRequest {
  url: string;
  authorization: string | undefined;
  model: string;
  reasoningEffort: string | undefined;
  hasSpanInfo: boolean;
}

/** A stand-in for the Grove gateway that always picks one grading choice. */
function startFakeGateway(choice: string) {
  const requests: JudgeRequest[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({
        url: req.url ?? "",
        authorization: req.headers.authorization,
        model: JSON.parse(body).model,
        reasoningEffort: JSON.parse(body).reasoning_effort,
        hasSpanInfo: "span_info" in JSON.parse(body),
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
                      arguments: JSON.stringify({ choice }),
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
  return new Promise<{ url: string; requests: JudgeRequest[]; stop(): void }>(
    (resolve) =>
      server.listen(0, "127.0.0.1", () =>
        resolve({
          url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
          requests,
          stop: () => server.close(),
        }),
      ),
  );
}

describe("Factuality with the judge config", () => {
  let gateway: Awaited<ReturnType<typeof startFakeGateway>>;
  beforeEach(async () => {
    gateway = await startFakeGateway("C");
  });
  afterEach(() => gateway.stop());

  const args = (referenceAnswer: string | undefined) =>
    ({
      input: {
        messages: [{ role: "user", content: "What is a replica set?" }],
      },
      expected: { referenceAnswer },
      output: {
        messages: [],
        assistantMessageContent: "A group of mongod processes.",
        allowedQuery: true,
      },
    }) as never;

  const factuality = () =>
    makeFactuality(
      judgeModelConfig(
        { endpoint: gateway.url },
        { OPENAI_API_KEY: "test-key" },
      ),
    );

  it("grades against the reference answer through the gateway", async () => {
    const scores = (await factuality()(
      args("A replica set is a group of mongod processes."),
    )) as unknown as { name: string; score: number | null }[];

    expect(scores.find((s) => s.name === "Factuality")?.score).toBe(1);
    expect(scores.find((s) => s.name === "ReferenceAlignment")?.score).toBe(1);
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]).toEqual({
      url: "/v1/chat/completions",
      authorization: "Bearer test-key",
      model: "gpt-6-luna",
      reasoningEffort: "none",
      hasSpanInfo: false,
    });
  });

  it("does not leak the span_info autoevals adds inside a Braintrust run", async () => {
    const flag = "__inherited_braintrust_wrap_openai";
    const g = globalThis as Record<string, unknown>;
    g[flag] = true;
    try {
      await factuality()(args("A replica set is a group of mongod processes."));
    } finally {
      delete g[flag];
    }
    expect(gateway.requests[0]?.hasSpanInfo).toBe(false);
  });

  it("sends the configured reasoning effort, or none when it is empty", async () => {
    const run = async (reasoningEffort: string) =>
      makeFactuality(
        judgeModelConfig(
          { endpoint: gateway.url, reasoningEffort },
          { OPENAI_API_KEY: "test-key" },
        ),
      )(args("A replica set is a group of mongod processes."));

    await run("low");
    await run("");
    expect(gateway.requests.map((r) => r.reasoningEffort)).toEqual([
      "low",
      undefined,
    ]);
  });

  it("skips a case with no reference answer without calling the judge", async () => {
    const scores = (await factuality()(args(undefined))) as unknown as {
      score: number | null;
    }[];

    expect(scores.every((s) => s.score === null)).toBe(true);
    expect(gateway.requests).toHaveLength(0);
  });
});
