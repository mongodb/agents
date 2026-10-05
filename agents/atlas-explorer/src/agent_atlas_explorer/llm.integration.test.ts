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

import "dotenv/config";

import { describe, expect, it } from "vitest";

import { buildLLM } from "@repo/atlas-explorer-agent";

import { atlasExplorerConfig } from "./config.js";

const PROMPT = "Reply with the single word pong.";
const TIMEOUT_MS = 120_000;

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (
        block &&
        typeof block === "object" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }
      return "";
    })
    .join("");
}

async function pingProvider(
  provider: "openai" | "anthropic",
  model: string,
  envKey: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY",
): Promise<void> {
  if (!process.env[envKey]?.trim()) {
    throw new Error(
      `${envKey} is not set. Add it to .env before running pnpm test:integration.`,
    );
  }

  const llm = buildLLM({ provider, model });
  const response = await llm.invoke(PROMPT);
  const text =
    "text" in response && typeof response.text === "string"
      ? response.text
      : contentText(response.content);
  expect(text.toLowerCase()).toContain("pong");
}

describe.skipIf(Boolean(process.env.CI))("LLM API keys", () => {
  it(
    `OpenAI ${atlasExplorerConfig.llm.model} accepts OPENAI_API_KEY`,
    async () => {
      await pingProvider(
        atlasExplorerConfig.llm.provider,
        atlasExplorerConfig.llm.model,
        "OPENAI_API_KEY",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "Anthropic claude-sonnet-4-5 accepts ANTHROPIC_API_KEY",
    async () => {
      await pingProvider("anthropic", "claude-sonnet-4-5", "ANTHROPIC_API_KEY");
    },
    TIMEOUT_MS,
  );
});
