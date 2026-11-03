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

import { resolveOpenAIConnection } from "@repo/agent-engine-core";
import type { JudgeModelConfig } from "mongodb-assistant-eval/scorers";
import OpenAI from "openai";

/**
 * The judge is set apart from the agent's model, so swapping the agent's model
 * does not change how answers are graded.
 */
export const DEFAULT_JUDGE_MODEL = "gpt-6-luna";

/** Used when no endpoint is configured, as `buildLLM` does for the agent. */
export const DEFAULT_JUDGE_ENDPOINT = "https://api.openai.com/v1";

/**
 * Factuality asks the judge to call a function. Reasoning models reject
 * function tools on `/v1/chat/completions` unless reasoning is off, and the
 * library gives no way to set it, so the judge client sets it on each request.
 */
export const DEFAULT_JUDGE_REASONING_EFFORT = "none";

/** Judge settings. Each one overrides the environment variable named after it. */
export interface JudgeModelOptions {
  /** Defaults to `EVAL_JUDGE_MODEL`, then `DEFAULT_JUDGE_MODEL`. */
  readonly model?: string;
  /** Defaults to `EVAL_JUDGE_API_KEY`, then `OPENAI_API_KEY`. */
  readonly apiKey?: string;
  /**
   * Defaults to `EVAL_JUDGE_ENDPOINT`, then `OPENAI_BASE_URL` (the Grove
   * gateway the agent uses), then `DEFAULT_JUDGE_ENDPOINT`.
   */
  readonly endpoint?: string;
  /**
   * Sent as `reasoning_effort` on every judge request. Defaults to
   * `EVAL_JUDGE_REASONING_EFFORT`, then `DEFAULT_JUDGE_REASONING_EFFORT`. An
   * empty string leaves it out, for models that reject the parameter.
   */
  readonly reasoningEffort?: string;
}

/**
 * Judge model settings for the LLM-judge scorers.
 *
 * The judge reaches its model the way the agent does: the endpoint and key go
 * through `resolveOpenAIConnection`, so a Grove URL gets its `api-key` header.
 *
 * Nothing is read until a scorer asks for the client, so runs whose cases need
 * no judge (the smoke datasets, scripted runs) work without a key.
 */
export function judgeModelConfig(
  options: JudgeModelOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): JudgeModelConfig {
  const apiKey = () => {
    const key = options.apiKey || env.EVAL_JUDGE_API_KEY || env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "The judge model needs an API key. Set EVAL_JUDGE_API_KEY or OPENAI_API_KEY, or pass apiKey to judgeModelConfig().",
      );
    }
    return key;
  };
  const connection = () => {
    const configured =
      options.endpoint || env.EVAL_JUDGE_ENDPOINT || env.OPENAI_BASE_URL;
    return resolveOpenAIConnection(
      {
        baseUrl: configured || DEFAULT_JUDGE_ENDPOINT,
        apiKey: apiKey(),
      },
      env,
    );
  };

  const reasoningEffort = () =>
    options.reasoningEffort ??
    env.EVAL_JUDGE_REASONING_EFFORT ??
    DEFAULT_JUDGE_REASONING_EFFORT;

  let client: JudgeModelConfig["client"] | undefined;

  return {
    modelId: options.model || env.EVAL_JUDGE_MODEL || DEFAULT_JUDGE_MODEL,
    get client() {
      // The library's types come from the CommonJS build of `openai` and ours
      // from the ESM build. They are the same package, and TypeScript treats
      // the two private class brands as different.
      client ??= withReasoningEffort(
        new OpenAI({ apiKey: apiKey(), ...connection() }),
        reasoningEffort(),
      ) as unknown as JudgeModelConfig["client"];
      return client;
    },
    // Factuality does not read this. The library's AI SDK judge helper
    // (`createEvalJudgeModel`) does, and the type requires it, so it carries
    // the same endpoint and key as the client.
    get braintrustProxy() {
      return { apiKey: apiKey(), endpoint: connection().baseURL };
    },
  };
}

function withReasoningEffort(client: OpenAI, effort: string): OpenAI {
  if (!effort) return client;
  const completions = client.chat.completions;
  const create = completions.create.bind(completions) as (
    body: object,
    options?: object,
  ) => unknown;
  completions.create = ((body: object, options?: object) =>
    create({ reasoning_effort: effort, ...body }, options)) as never;
  return client;
}
