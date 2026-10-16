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
import {
  AIMessage,
  HumanMessage,
  type MessageContent,
} from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { z } from "zod";

import type { InputGuardConfig, InputGuardMode } from "./inputGuardConfig.js";
import {
  createLlmInjectionJudge,
  type InjectionJudge,
} from "./inputGuardJudge.js";
import { redactContent } from "./redactSecrets.js";
import { isAgentEngineResume } from "./stampResume.js";

export interface InputGuardOptions {
  /** Defaults to "enforce". "monitor" logs without blocking or modifying. */
  mode?: InputGuardMode;
  /** Optional judge that runs after the length check and redaction. */
  judge?: InjectionJudge;
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
  "I can't act on that message because I can only screen messages up to " +
  `${INPUT_GUARD_MAX_SCREEN_CHARS.toLocaleString("en-US")} characters. ` +
  "Please split it into smaller parts and send them separately.";

/** A content block that carries message text. */
const textBlockSchema = z.object({ text: z.string() });

function contentText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      const parsed = textBlockSchema.safeParse(block);
      return parsed.success ? parsed.data.text : "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * One guard decision as facts safe to log: a length, a boolean, or a secret
 * kind from the redaction engine's fixed vocabulary. No field can carry
 * message text, so the real message can't reach the log through
 * {@link formatInputGuardLog}.
 */
export type InputGuardLog =
  | {
      readonly action: "refuse";
      readonly would: boolean;
      readonly length: number;
    }
  | {
      readonly action: "redact";
      readonly would: boolean;
      readonly secrets: readonly string[];
    }
  | {
      readonly action: "block";
      readonly would: boolean;
      readonly length: number;
    }
  | {
      readonly action: "judge-failed-open";
      readonly error: unknown;
      readonly length: number;
    };

const LOG_PHRASES = {
  refuse: { done: "refused", would: "would refuse" },
  redact: { done: "redacted", would: "would redact" },
  block: { done: "blocked injection", would: "would block injection" },
} as const;

/**
 * Formats the one `[inputGuard]` line for a decision. Pure, so it can be
 * tested directly. Every part comes from `InputGuardLog` facts: lengths,
 * secret kinds and error names only, never message text.
 */
export function formatInputGuardLog(log: InputGuardLog): string {
  const parts: string[] =
    log.action === "judge-failed-open"
      ? ["judge failed open", `error=${errorName(log.error)}`]
      : [LOG_PHRASES[log.action][log.would ? "would" : "done"]];
  if (log.action === "redact") {
    parts.push(`secrets=${[...new Set(log.secrets)].join(",")}`);
  } else {
    parts.push(`length=${log.length}`);
    if (log.action === "refuse") {
      parts.push(`limit=${INPUT_GUARD_MAX_SCREEN_CHARS}`);
    }
  }
  return `[inputGuard] ${parts.join(" ")}`;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
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
 * Builds the middleware from an agent's config. `buildJudgeModel` is only
 * called when the judge is enabled, and should return the model wrapped by
 * `app.llm(model, INPUT_GUARD_JUDGE_LLM_ID)`. It must run inside the app's
 * entrypoint, because the SDK rejects `app.llm()` calls made outside it.
 * `modelName` is `config.judge.model`, or undefined to use the agent's own
 * model.
 */
export function inputGuardFromConfig(
  config: InputGuardConfig,
  buildJudgeModel: (modelName: string | undefined) => BaseChatModel,
) {
  const judge =
    config.mode !== "off" && config.judge.enabled
      ? createLlmInjectionJudge(buildJudgeModel(config.judge.model), {
          timeoutMs: config.judge.timeoutMs,
        })
      : undefined;
  return createInputGuardMiddleware({ mode: config.mode, judge });
}

/**
 * Screens the latest user message before the model sees it. This is a
 * LangChain `beforeAgent` middleware, so it runs on the agent side and covers
 * every client. It skips approval resumes and turns whose last message isn't
 * from the user.
 *
 * For each message it runs these steps in order:
 *
 * 1. Refuses messages over `INPUT_GUARD_MAX_SCREEN_CHARS` with a fixed reply
 *    before the model is called. Screening can't be trusted on inputs this
 *    size, so the middle of the message never reaches the model.
 * 2. Redacts pasted secrets: connection strings with passwords, `mdb_sa_sk_`
 *    and `sk-` keys, and private keys. It uses the same rules as the redaction
 *    of model replies. The model and the checkpoint only see the redacted text.
 * 3. When a judge is set with {@link createLlmInjectionJudge}, asks it whether
 *    the redacted message tries to override the assistant's instructions, and
 *    refuses the message when it says so. A judge error fails open.
 *
 * Each decision logs one `[inputGuard]` line: the message length for a
 * refusal, block or judge failure, the secret kinds for a redaction, and the
 * error name for a judge failure. Never the text.
 * `mode: "monitor"` logs what would happen and changes nothing.
 * `mode: "off"` disables the guard.
 *
 * Limits:
 * - It does not redact PII. Emails, IPs, timestamps and ObjectIds are normal
 *   Atlas input.
 * - It does not screen tool output, so indirect injection through documents,
 *   `$comment` values and logs is not covered.
 *
 * The structural controls (read-only roles, approval for writes, the egress
 * policy and the untrusted-data prompt rule) are what bound the agents.
 */
export function createInputGuardMiddleware(options: InputGuardOptions = {}) {
  const mode = options.mode ?? "enforce";
  const judge = options.judge;

  const warn = (log: InputGuardLog): void => {
    console.warn(formatInputGuardLog(log));
  };

  return createMiddleware({
    name: "inputGuard",
    beforeAgent: {
      canJumpTo: ["end"],
      hook: async (state, runtime) => {
        if (mode === "off" || isAgentEngineResume(runtime)) return undefined;

        const last = state.messages.at(-1);
        if (!HumanMessage.isInstance(last)) return undefined;

        const raw = contentText(last.content);
        const enforce = mode === "enforce";
        if (raw.length > INPUT_GUARD_MAX_SCREEN_CHARS) {
          warn({ action: "refuse", would: !enforce, length: raw.length });
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
        if (redacted.kinds.length > 0) {
          warn({
            action: "redact",
            would: !enforce,
            secrets: redacted.kinds,
          });
        }

        const text = contentText(redacted.content);
        let judgeFlagged = false;
        if (judge !== undefined && text.trim().length > 0) {
          try {
            judgeFlagged = await judge(text);
          } catch (error) {
            warn({
              action: "judge-failed-open",
              error,
              length: text.length,
            });
          }
        }

        if (judgeFlagged) {
          warn({ action: "block", would: !enforce, length: text.length });
          if (!enforce) return undefined;
          return {
            messages: [
              replacement(last, INPUT_GUARD_PLACEHOLDER),
              new AIMessage(INPUT_GUARD_REFUSAL),
            ],
            jumpTo: "end" as const,
          };
        }

        if (enforce && redacted.kinds.length > 0) {
          return { messages: [replacement(last, redacted.content)] };
        }
        return undefined;
      },
    },
  });
}