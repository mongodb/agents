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

/**
 * LLM provider selection.
 *
 * Supported providers: anthropic, cerebras, gemini, openai.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { ChatCerebras } from "@langchain/cerebras";

function log(prefix: string, msg: string): void {
  console.log(`[${prefix}] ${msg}`);
}

export interface BuildLLMOptions {
  provider?: string | null;
  model?: string | null;
  temperature?: number;
  /** Log tag, for example "atlas-explorer". Defaults to "agent". */
  logPrefix?: string;
}

export function resolveOpenAIResponsesApi(
  model: string,
  env: { OPENAI_USE_RESPONSES_API?: string } = process.env,
): boolean | undefined {
  const configured = env.OPENAI_USE_RESPONSES_API?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  if (configured && configured !== "auto") {
    throw new Error(
      "OPENAI_USE_RESPONSES_API must be 'auto', 'true', or 'false'",
    );
  }

  const isReasoningModel =
    /^o\d/.test(model) ||
    (model.startsWith("gpt-5") && !model.startsWith("gpt-5-chat")) ||
    (model.startsWith("gpt-6") && !model.startsWith("gpt-6-chat"));
  return isReasoningModel ? true : undefined;
}

export function buildLLM(opts: BuildLLMOptions = {}): BaseChatModel {
  const configuredProvider = (opts.provider ?? "").trim().toLowerCase();
  const model = opts.model ?? null;
  const temperature = opts.temperature;
  const write = (msg: string) => log(opts.logPrefix?.trim() || "agent", msg);

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  const openaiBaseUrl = process.env.OPENAI_BASE_URL ?? "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL ?? "";
  const cerebrasKey = process.env.CEREBRAS_API_KEY ?? "";

  const buildGemini = (): BaseChatModel => {
    const modelName = model ?? "gemini-2.5-flash";
    write(`Using Gemini LLM: ${modelName}`);
    return new ChatGoogleGenerativeAI({
      apiKey: geminiKey,
      model: modelName,
      temperature,
    });
  };

  const buildOpenAI = (): BaseChatModel => {
    const modelName = model ?? "gpt-4o-mini";
    const useResponsesApi = resolveOpenAIResponsesApi(modelName);
    write(`Using OpenAI LLM: ${modelName}`);
    const config: ConstructorParameters<typeof ChatOpenAI>[0] = {
      apiKey: openaiKey,
      model: modelName,
      temperature,
      ...(useResponsesApi !== undefined ? { useResponsesApi } : {}),
    };
    if (openaiBaseUrl) {
      const headers: Record<string, string> = {};
      let baseURL = openaiBaseUrl.replace(/\/$/, "");
      if (openaiBaseUrl.includes("grove-foundry")) {
        baseURL = openaiBaseUrl.split("/v1")[0] + "/v1";
        headers["api-key"] = openaiKey;
      }
      const defaultQuery: Record<string, string> = {};
      if (openaiBaseUrl.toLowerCase().includes("/openai/deployments/")) {
        const apiVersion =
          process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";
        defaultQuery["api-version"] = apiVersion;
        headers["api-key"] = openaiKey;
      }
      config.configuration = {
        baseURL,
        defaultHeaders: Object.keys(headers).length ? headers : undefined,
        defaultQuery: Object.keys(defaultQuery).length
          ? defaultQuery
          : undefined,
      };
    }
    return new ChatOpenAI(config);
  };

  const buildAnthropic = (): BaseChatModel => {
    const modelName = model ?? "claude-sonnet-4-5";
    write(`Using Anthropic LLM: ${modelName}`);
    const config: ConstructorParameters<typeof ChatAnthropic>[0] = {
      apiKey: anthropicKey,
      model: modelName,
      temperature,
    };
    if (anthropicBaseUrl) {
      if (anthropicBaseUrl.includes("grove-foundry")) {
        const apiUrl = anthropicBaseUrl.split("/v1")[0].replace(/\/$/, "");
        config.anthropicApiUrl = apiUrl;
        config.clientOptions = {
          defaultHeaders: { "api-key": anthropicKey },
        };
      } else {
        config.anthropicApiUrl = anthropicBaseUrl.replace(/\/$/, "");
      }
    }
    return new ChatAnthropic(config);
  };

  const buildCerebras = (): BaseChatModel => {
    const modelName = model ?? "qwen-3-235b-a22b-instruct-2507";
    write(`Using Cerebras LLM: ${modelName}`);
    return new ChatCerebras({
      apiKey: cerebrasKey,
      model: modelName,
      temperature,
    });
  };

  const builders: Record<string, [string, () => BaseChatModel]> = {
    gemini: [geminiKey, buildGemini],
    openai: [openaiKey, buildOpenAI],
    anthropic: [anthropicKey, buildAnthropic],
    cerebras: [cerebrasKey, buildCerebras],
  };

  if (configuredProvider) {
    if (!(configuredProvider in builders)) {
      throw new Error(
        "Unsupported LLM provider. Use one of: anthropic, cerebras, gemini, openai.",
      );
    }
    const [providerKey, providerBuilder] = builders[configuredProvider]!;
    if (providerKey) {
      return providerBuilder();
    }
    throw new Error(
      `LLM provider "${configuredProvider}" is configured, but its API key is missing.`,
    );
  }

  for (const [providerKey, providerBuilder] of Object.values(builders)) {
    if (providerKey) {
      return providerBuilder();
    }
  }

  throw new Error(
    "No LLM API key found. Set one of: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, CEREBRAS_API_KEY.",
  );
}
