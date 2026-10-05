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

import { resolveOpenAIResponsesApi } from "./llm.js";

describe("resolveOpenAIResponsesApi", () => {
  it("enables the Responses API for OpenAI reasoning models by default", () => {
    expect(resolveOpenAIResponsesApi("gpt-5.4-mini", {})).toBe(true);
    expect(resolveOpenAIResponsesApi("gpt-6-luna", {})).toBe(true);
    expect(resolveOpenAIResponsesApi("o4-mini", {})).toBe(true);
    expect(resolveOpenAIResponsesApi("gpt-4o", {})).toBeUndefined();
  });

  it("honors an explicit true, false, or auto setting", () => {
    expect(
      resolveOpenAIResponsesApi("gpt-4o", {
        OPENAI_USE_RESPONSES_API: "true",
      }),
    ).toBe(true);
    expect(
      resolveOpenAIResponsesApi("gpt-5.4-mini", {
        OPENAI_USE_RESPONSES_API: "false",
      }),
    ).toBe(false);
    expect(
      resolveOpenAIResponsesApi("gpt-5.4-mini", {
        OPENAI_USE_RESPONSES_API: "auto",
      }),
    ).toBe(true);
  });

  it("rejects an invalid setting instead of silently choosing an API", () => {
    expect(() =>
      resolveOpenAIResponsesApi("gpt-5.4-mini", {
        OPENAI_USE_RESPONSES_API: "sometimes",
      }),
    ).toThrow(
      "OPENAI_USE_RESPONSES_API must be 'auto', 'true', or 'false'",
    );
  });
});
