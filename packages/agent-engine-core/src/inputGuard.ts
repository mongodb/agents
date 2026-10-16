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

import {
  AIMessage,
  HumanMessage,
  type MessageContent,
} from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { redactContent } from "./redactSecrets.js";
import type { InputGuardMode } from "./inputGuardConfig.js";
import { isAgentEngineResume } from "./stampResume.js";

export interface InputGuardOptions {
  /** Defaults to "enforce". "monitor" logs without blocking or modifying. */
  mode?: InputGuardMode;
}

export const INPUT_GUARD_REFUSAL =
  "I can't act on that message because it looks like an attempt to change " +
  "my instructions. Please rephrase your question about your MongoDB or " +
  "Atlas deployment.";

/** Messages longer than this many characters are refused. */
export const INPUT_GUARD_MAX_SCREEN_CHARS = 100_000;

export const INPUT_GUARD_PLACEHOLDER =
  "[Message removed by the input guard]";

/** The refusal reply for a message over `INPUT_GUARD_MAX_SCREEN_CHARS`. */
export const INPUT_GUARD_TOO_LONG =
  "I can't act on that message because it is too long for me to screen. " +
  "Please split it into smaller parts and send them separately.";

function contentText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((block) =>
      "text" in block && typeof block.text === "string" ? block.text : "",
    )
    .filter((text) => text.length > 0)
    .join("\n");
}

function warn(message: string): void {
  console.warn(`[inputGuard] ${message}`);
}

function replacement(original: HumanMessage, content: MessageContent) {
  return new HumanMessage({
    id: original.id,
    content,
    name: original.name,
    additional_kwargs: original.additional_kwargs,
    response_metadata: original.response_metadata,
  });
}

/**
 * Screens the latest user message before the model sees it. This is a
 * LangChain `beforeAgent` middleware, so it runs on the agent side and covers
 * every client. It skips approval resumes and turns whose last message isn't
 * from the user.
 *
 * For each message it runs these steps in order:
 *
 * 1. Redacts pasted secrets: connection strings with passwords, `mdb_sa_sk_`
 *    and `sk-` keys, and private keys. It uses the same rules as the redaction
 *    of model replies. The model and the checkpoint only see the redacted text.
 * 2. Refuses messages over `INPUT_GUARD_MAX_SCREEN_CHARS` with a fixed reply
 *    before the model is called.
 *
 * Each decision logs one `[inputGuard]` line with the message length, never
 * the text. `mode: "monitor"` logs what would happen and changes nothing.
 * `mode: "off"` disables the guard.
 *
 * Limits:
 * - It does not redact PII. Emails, IPs, timestamps and ObjectIds are normal
 *   Atlas input.
 * - It does not screen tool output, so indirect injection through documents,
 *   `$comment` values and logs is not covered.
 *
 * The structural controls (read-only roles, approval for writes, the egress
 * policy and the untrusted-data prompt rule) are what bound the agents. An
 * optional LLM judge can screen for prompt injection on top of this guard.
 */
export function createInputGuardMiddleware(options: InputGuardOptions = {}) {
  const mode = options.mode ?? "enforce";

  return createMiddleware({
    name: "inputGuard",
    beforeAgent: {
      canJumpTo: ["end"],
      hook: (state, runtime) => {
        if (mode === "off" || isAgentEngineResume(runtime)) return undefined;

        const last = state.messages.at(-1);
        if (!HumanMessage.isInstance(last)) return undefined;

        const raw = contentText(last.content);
        const enforce = mode === "enforce";
        if (raw.length > INPUT_GUARD_MAX_SCREEN_CHARS) {
          warn(
            `${enforce ? "refused" : "would refuse"} length=${raw.length} ` +
              `limit=${INPUT_GUARD_MAX_SCREEN_CHARS}`,
          );
          if (!enforce) return undefined;
          return {
            messages: [
              replacement(last, INPUT_GUARD_PLACEHOLDER),
              new AIMessage(INPUT_GUARD_TOO_LONG),
            ],
            jumpTo: "end" as const,
          };
        }

        const redacted = redactContent(last.content);
        const text = contentText(redacted.content);
        if (redacted.kinds.length > 0) {
          warn(
            `${enforce ? "redacted" : "would redact"} ` +
              `secrets=${[...new Set(redacted.kinds)].join(",")}`,
          );
        }
        if (text.trim().length === 0) return undefined;

        if (enforce && redacted.kinds.length > 0) {
          return { messages: [replacement(last, redacted.content)] };
        }
        return undefined;
      },
    },
  });
}
