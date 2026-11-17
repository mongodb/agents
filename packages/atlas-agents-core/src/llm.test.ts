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

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildLLM, resolveOpenAIResponsesApi } from "./llm.js";

const PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CEREBRAS_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_USE_RESPONSES_API",
] as const;

describe("buildLLM with the Anthropic provider", () => {
  beforeEach(() => {
    for (const name of PROVIDER_ENV_VARS) {
      vi.stubEnv(name, "");
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("builds a ChatAnthropic with a default Claude model", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    const llm = buildLLM({ provider: "anthropic" });

    expect(llm).toBeInstanceOf(ChatAnthropic);
    expect((llm as ChatAnthropic).model).toContain("claude");
  });

  it("uses the configured model", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    const llm = buildLLM({ provider: "anthropic", model: "claude-opus-4-1" });

    expect((llm as ChatAnthropic).model).toBe("claude-opus-4-1");
  });

  it("accepts the provider name in any case", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    expect(buildLLM({ provider: " Anthropic " })).toBeInstanceOf(ChatAnthropic);
  });

  it("selects Anthropic even when an OpenAI key is also set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");

    const llm = buildLLM({ provider: "anthropic" });

    expect(llm).toBeInstanceOf(ChatAnthropic);
    expect(llm).not.toBeInstanceOf(ChatOpenAI);
  });

  it("points at ANTHROPIC_BASE_URL without a trailing slash", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://proxy.example.com/");

    const llm = buildLLM({ provider: "anthropic" }) as ChatAnthropic;

    expect(llm.apiUrl).toBe("https://proxy.example.com");
  });

  it("strips /v1 and sends the api-key header for Grove Foundry", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "grove-key");
    vi.stubEnv(
      "ANTHROPIC_BASE_URL",
      "https://grove-foundry.example.com/anthropic/v1",
    );

    const llm = buildLLM({ provider: "anthropic" }) as ChatAnthropic;

    expect(llm.apiUrl).toBe("https://grove-foundry.example.com/anthropic");
    expect(llm.clientOptions).toMatchObject({
      defaultHeaders: { "api-key": "grove-key" },
    });
  });

  it("throws when the Anthropic key is missing", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");

    expect(() => buildLLM({ provider: "anthropic" })).toThrow(
      'LLM provider "anthropic" is configured, but its API key is missing.',
    );
  });

  it("falls back to Anthropic when it is the only key and no provider is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    expect(buildLLM()).toBeInstanceOf(ChatAnthropic);
  });

  it("rejects an unknown provider and names the supported ones", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    expect(() => buildLLM({ provider: "mistral" })).toThrow(
      "Unsupported LLM provider. Use one of: anthropic, cerebras, gemini, openai.",
    );
  });
});

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
