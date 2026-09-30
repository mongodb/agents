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
