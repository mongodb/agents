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
import { redactSecretText } from "./redactSecrets.js";
import { isAgentEngineResume } from "./stampResume.js";

export interface InputRefusalOptions {
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

function warn(log: InputGuardLog): void {
  console.warn(formatInputGuardLog(log));
}

/**
 * Returns a function that redacts pasted secrets from the user's message text:
 * connection strings with passwords, `mdb_sa_sk_` and `sk-` keys, and private
 * keys. It uses the same rules as the redaction of model replies.
 *
 * Pass it to `prepareAgentInput`. LangGraph checkpoints the raw input before
 * any middleware runs, so this is the only place to keep a secret out of a
 * thread's first checkpoints.
 *
 * "enforce" redacts. "monitor" logs what it would redact and returns the text
 * unchanged. "off" returns the text unchanged. Each decision logs one
 * `[inputGuard]` line with the secret kinds, never the text.
 */
export function createInputRedactor(
  mode: InputGuardMode,
): (text: string) => string {
  if (mode === "off") return (text) => text;
  const enforce = mode === "enforce";
  return (text) => {
    const redacted = redactSecretText(text);
    if (redacted.kinds.length > 0) {
      warn({ action: "redact", would: !enforce, secrets: redacted.kinds });
    }
    return enforce ? redacted.text : text;
  };
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
export function inputRefusalFromConfig(
  config: InputGuardConfig,
  buildJudgeModel: (modelName: string | undefined) => BaseChatModel,
) {
  const judge =
    config.mode !== "off" && config.judge.enabled
      ? createLlmInjectionJudge(buildJudgeModel(config.judge.model), {
          timeoutMs: config.judge.timeoutMs,
        })
      : undefined;
  return createInputRefusalMiddleware({ mode: config.mode, judge });
}

/**
 * Refuses a user message the agent won't act on, before the model sees it.
 * This is a LangChain `beforeAgent` middleware, so it runs on the agent side
 * and covers every client. It skips approval resumes and turns whose last
 * message isn't from the user.
 *
 * It refuses in two cases, and a refusal ends the turn. The model is not
 * called, and the message in state is replaced with a placeholder so it isn't
 * resent on later turns:
 *
 * 1. The message is over `INPUT_GUARD_MAX_SCREEN_CHARS`. Screening can't be
 *    trusted on inputs this size, so the middle of the message never reaches
 *    the model. The reply is `INPUT_GUARD_TOO_LONG`.
 * 2. A judge is set with {@link createLlmInjectionJudge} and says the message
 *    tries to override the assistant's instructions. The reply is
 *    `INPUT_GUARD_REFUSAL`. A judge error fails open.
 *
 * It does not redact secrets. That happens before the graph, in
 * {@link createInputRedactor}, because LangGraph saves the input to its first
 * checkpoints before any middleware runs.
 *
 * Each decision logs one `[inputGuard]` line: the message length for a
 * refusal, block or judge failure, and the error name for a judge failure.
 * Never the text. `mode: "monitor"` logs what would happen and changes
 * nothing. `mode: "off"` disables it.
 *
 * Limits:
 * - Nothing redacts PII. Emails, IPs, timestamps and ObjectIds are normal
 *   Atlas input.
 * - Nothing screens tool output, so indirect injection through documents,
 *   `$comment` values and logs is not covered.
 *
 * The structural controls (read-only roles, approval for writes, the egress
 * policy and the untrusted-data prompt rule) are what bound the agents.
 */
export function createInputRefusalMiddleware(
  options: InputRefusalOptions = {},
) {
  const mode = options.mode ?? "enforce";
  const judge = options.judge;

  return createMiddleware({
    name: "inputRefusal",
    beforeAgent: {
      canJumpTo: ["end"],
      hook: async (state, runtime) => {
        if (mode === "off" || isAgentEngineResume(runtime)) return undefined;

        const last = state.messages.at(-1);
        if (!HumanMessage.isInstance(last)) return undefined;

        const text = contentText(last.content);
        const enforce = mode === "enforce";
        if (text.length > INPUT_GUARD_MAX_SCREEN_CHARS) {
          warn({ action: "refuse", would: !enforce, length: text.length });
          if (!enforce) return undefined;
          return {
            messages: [
              replacement(last, INPUT_GUARD_PLACEHOLDER),
              new AIMessage(INPUT_GUARD_TOO_LONG),
            ],
            jumpTo: "end" as const,
          };
        }

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

        if (!judgeFlagged) return undefined;
        warn({ action: "block", would: !enforce, length: text.length });
        if (!enforce) return undefined;
        return {
          messages: [
            replacement(last, INPUT_GUARD_PLACEHOLDER),
            new AIMessage(INPUT_GUARD_REFUSAL),
          ],
          jumpTo: "end" as const,
        };
      },
    },
  });
}
