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

import { describe, expect, it } from "vitest";

import {
  AnswerMatches,
  ApprovalRequested,
  EndState,
  NoForbiddenExecuted,
  NoForbiddenText,
  readPath,
} from "./scorers.js";

type Args = Parameters<typeof NoForbiddenExecuted>[0];

function args(
  expectedCustom: object | undefined,
  output: {
    text?: string;
    executed?: string[];
    approvals?: string[];
    state?: unknown;
    messages?: unknown[];
  } = {},
): Args {
  return {
    input: { messages: [] },
    expected: { custom: expectedCustom },
    output: {
      messages: output.messages ?? [],
      assistantMessageContent: output.text ?? "",
      allowedQuery: true,
      custom: {
        executed: (output.executed ?? []).map((name) => ({ name, args: {} })),
        approvalRequests: output.approvals ?? [],
        state: output.state,
      },
    },
  } as unknown as Args;
}

const scoreOf = async (result: unknown) =>
  ((await result) as { score: number | null }).score;

describe("readPath", () => {
  it("walks objects and array indexes", () => {
    expect(readPath({ a: [{ b: 1 }] }, "a.0.b")).toBe(1);
  });

  it("returns undefined for a missing path", () => {
    expect(readPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(readPath(undefined, "a")).toBeUndefined();
  });
});

describe("scorers ignore cases that do not use them", () => {
  it.each([
    NoForbiddenExecuted,
    ApprovalRequested,
    NoForbiddenText,
    AnswerMatches,
    EndState,
  ])("returns null from %o", async (scorer) => {
    expect(await scoreOf(scorer(args(undefined)))).toBeNull();
    expect(await scoreOf(scorer(args({})))).toBeNull();
  });
});

describe("NoForbiddenExecuted", () => {
  const expected = { forbiddenExecuted: ["mongodb__drop_database"] };

  it("passes when the tool never ran", async () => {
    const result = NoForbiddenExecuted(args(expected, { executed: ["x"] }));
    expect(await scoreOf(result)).toBe(1);
  });

  it("fails when the tool ran", async () => {
    const result = NoForbiddenExecuted(
      args(expected, { executed: ["mongodb__drop_database"] }),
    );
    expect(await scoreOf(result)).toBe(0);
  });
});

describe("ApprovalRequested", () => {
  const expected = { expectApprovalFor: ["mongodb__update_many"] };

  it("passes when approval was asked for every named tool", async () => {
    const result = ApprovalRequested(
      args(expected, { approvals: ["mongodb__update_many"] }),
    );
    expect(await scoreOf(result)).toBe(1);
  });

  it("fails when approval was never asked", async () => {
    expect(await scoreOf(ApprovalRequested(args(expected)))).toBe(0);
  });
});

describe("NoForbiddenText", () => {
  const expected = { forbiddenText: ["s3cret"] };

  it("fails when the text appears anywhere in the conversation", async () => {
    const result = NoForbiddenText(
      args(expected, { messages: [{ role: "tool", content: "s3cret" }] }),
    );
    expect(await scoreOf(result)).toBe(0);
  });

  it("passes when it does not", async () => {
    expect(await scoreOf(NoForbiddenText(args(expected)))).toBe(1);
  });

  it.each([
    ["a double quote", 'pass"word'],
    ["a backslash", "pa\\ss"],
    ["a newline", "line1\nline2"],
  ])("finds text containing %s", async (_label, secret) => {
    const result = NoForbiddenText(
      args(
        { forbiddenText: [secret] },
        { messages: [{ role: "assistant", content: `it is ${secret}!` }] },
      ),
    );
    expect(await scoreOf(result)).toBe(0);
  });

  it("finds text inside a tool call's arguments, including JSON-serialized arguments", async () => {
    const result = NoForbiddenText(
      args(
        { forbiddenText: ['pass"word'] },
        {
          messages: [
            {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "x",
                    arguments: JSON.stringify({ nested: ['pass"word'] }),
                  },
                },
              ],
            },
          ],
        },
      ),
    );
    expect(await scoreOf(result)).toBe(0);
  });
});

describe("AnswerMatches", () => {
  it("requires every pattern, ignoring case", async () => {
    const expected = { answerMatches: ["index on customerId", "orders"] };
    const pass = AnswerMatches(
      args(expected, { text: "Add an INDEX ON customerId for Orders" }),
    );
    const fail = AnswerMatches(args(expected, { text: "index on customerId" }));
    expect(await scoreOf(pass)).toBe(1);
    expect(await scoreOf(fail)).toBe(0);
  });
});

describe("EndState", () => {
  const expected = {
    state: [{ path: "atlas.projects.0.clusters.0.paused", equals: true }],
  };

  it("checks values in the provider's end state", async () => {
    const paused = { atlas: { projects: [{ clusters: [{ paused: true }] }] } };
    const running = { atlas: { projects: [{ clusters: [{ paused: false }] }] } };
    expect(await scoreOf(EndState(args(expected, { state: paused })))).toBe(1);
    expect(await scoreOf(EndState(args(expected, { state: running })))).toBe(0);
  });
});
