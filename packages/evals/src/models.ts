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

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { buildLLM } from "@repo/agent-engine-core";

import { ScriptedChatModel } from "./scriptedModel.js";
import type { CustomInput } from "./schemas.js";

/** One entry per `--model`. `scripted` needs no key. `llm` is the real model. */
export type ModelConfig =
  | { kind: "scripted" }
  | { kind: "llm"; provider: string; model: string };

export function makeChatModel(
  custom: CustomInput | undefined,
  config: ModelConfig,
): BaseChatModel {
  if (config.kind === "scripted") {
    if (!custom?.script?.length) {
      throw new Error("The scripted model needs input.custom.script");
    }
    // Content-block output, like ChatOpenAI on the Responses API.
    return new ScriptedChatModel(custom.script, true);
  }
  return buildLLM({
    provider: config.provider,
    model: config.model,
    logPrefix: "eval",
  });
}
