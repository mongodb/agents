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

import OpenAI from "openai";
import type { JudgeModelConfig } from "mongodb-assistant-eval/scorers";

/**
 * The judge is set apart from the agent's model, so swapping the agent's model
 * does not change how answers are graded.
 */
export const DEFAULT_JUDGE_MODEL = "gpt-6-luna";

/**
 * The judge defaults to the Braintrust proxy, which logs its calls next to the
 * run. Any OpenAI-compatible endpoint works instead.
 */
export const DEFAULT_JUDGE_ENDPOINT = "https://api.braintrust.dev/v1/proxy";

/** Judge settings. Each one overrides the environment variable named after it. */
export interface JudgeModelOptions {
  /** Defaults to `EVAL_JUDGE_MODEL`, then `DEFAULT_JUDGE_MODEL`. */
  readonly model?: string;
  /**
   * Defaults to `EVAL_JUDGE_API_KEY`, then `BRAINTRUST_API_KEY`, then
   * `OPENAI_API_KEY`: the proxy takes a Braintrust key, an OpenAI-compatible
   * endpoint takes that vendor's key.
   */
  readonly apiKey?: string;
  /** Defaults to `EVAL_JUDGE_ENDPOINT`, then `DEFAULT_JUDGE_ENDPOINT`. */
  readonly endpoint?: string;
}

/**
 * Judge model settings for the LLM-judge scorers.
 *
 * Nothing is read until a scorer asks for the client, so runs whose cases need
 * no judge (the smoke datasets, scripted runs) work without a key.
 */
export function judgeModelConfig(
  options: JudgeModelOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): JudgeModelConfig {
  const endpoint = () =>
    options.endpoint || env.EVAL_JUDGE_ENDPOINT || DEFAULT_JUDGE_ENDPOINT;
  const apiKey = () => {
    const key =
      options.apiKey ||
      env.EVAL_JUDGE_API_KEY ||
      env.BRAINTRUST_API_KEY ||
      env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "The judge model needs an API key. Set EVAL_JUDGE_API_KEY, BRAINTRUST_API_KEY or OPENAI_API_KEY, or pass apiKey to judgeModelConfig().",
      );
    }
    return key;
  };

  let client: JudgeModelConfig["client"] | undefined;

  return {
    modelId: options.model || env.EVAL_JUDGE_MODEL || DEFAULT_JUDGE_MODEL,
    get client() {
      // The library's types come from the CommonJS build of `openai` and ours
      // from the ESM build. They are the same package, and TypeScript treats
      // the two private class brands as different.
      client ??= new OpenAI({
        apiKey: apiKey(),
        baseURL: endpoint(),
      }) as unknown as JudgeModelConfig["client"];
      return client;
    },
    // The library's own judge model builder reads the same two values, so it
    // follows whatever endpoint and key are configured above.
    get braintrustProxy() {
      return { apiKey: apiKey(), endpoint: endpoint() };
    },
  };
}
