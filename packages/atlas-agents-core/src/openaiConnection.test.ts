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

import { resolveOpenAIConnection } from "./openaiConnection.js";

describe("resolveOpenAIConnection", () => {
  it("sends the Grove key in an api-key header and trims after /v1", () => {
    expect(
      resolveOpenAIConnection({
        baseUrl: "https://grove-foundry.example.com/v1/chat/completions",
        apiKey: "grove-key",
      }),
    ).toEqual({
      baseURL: "https://grove-foundry.example.com/v1",
      defaultHeaders: { "api-key": "grove-key" },
      defaultQuery: undefined,
    });
  });

  it("adds the api-version query for an Azure deployment URL", () => {
    expect(
      resolveOpenAIConnection(
        {
          baseUrl: "https://res.openai.azure.com/openai/deployments/gpt/",
          apiKey: "azure-key",
        },
        { AZURE_OPENAI_API_VERSION: "2025-01-01" },
      ),
    ).toEqual({
      baseURL: "https://res.openai.azure.com/openai/deployments/gpt",
      defaultHeaders: { "api-key": "azure-key" },
      defaultQuery: { "api-version": "2025-01-01" },
    });
  });

  it("leaves other OpenAI-compatible endpoints alone", () => {
    expect(
      resolveOpenAIConnection({
        baseUrl: "https://llm.example/v1/",
        apiKey: "sk-test",
      }),
    ).toEqual({
      baseURL: "https://llm.example/v1",
      defaultHeaders: undefined,
      defaultQuery: undefined,
    });
  });
});
