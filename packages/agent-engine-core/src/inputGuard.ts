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

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { redactSecretText } from "./redactSecrets.js";
import type { InputGuardMode } from "./inputGuardConfig.js";
import { isAgentEngineResume } from "./stampResume.js";

export interface InputRefusalOptions {
  /** Defaults to "enforce". "monitor" and "off" never refuse. */
  mode?: InputGuardMode;
}

/** Messages longer than this many characters are refused. */
export const INPUT_GUARD_MAX_SCREEN_CHARS = 100_000;

/**
 * What {@link createInputRedactor} puts in place of an over-limit message.
 * {@link createInputRefusalMiddleware} refuses a message with this text.
 */
export const INPUT_GUARD_PLACEHOLDER =
  "[Message removed by the input guard]";

/** The refusal reply for a message over `INPUT_GUARD_MAX_SCREEN_CHARS`. */
export const INPUT_GUARD_TOO_LONG =
  "I can't act on that message because I can only screen messages up to " +
  `${INPUT_GUARD_MAX_SCREEN_CHARS.toLocaleString("en-US")} characters. ` +
  "Please split it into smaller parts and send them separately.";

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
    };

const LOG_PHRASES = {
  refuse: { done: "refused", would: "would refuse" },
  redact: { done: "redacted", would: "would redact" },
} as const;

/**
 * Formats the one `[inputGuard]` line for a decision. Pure, so it can be
 * tested directly. Every part comes from `InputGuardLog` facts: lengths and
 * secret kinds only, never message text.
 */
export function formatInputGuardLog(log: InputGuardLog): string {
  const parts: string[] = [
    LOG_PHRASES[log.action][log.would ? "would" : "done"],
  ];
  if (log.action === "refuse") {
    parts.push(`length=${log.length}`);
    parts.push(`limit=${INPUT_GUARD_MAX_SCREEN_CHARS}`);
  } else {
    parts.push(`secrets=${[...new Set(log.secrets)].join(",")}`);
  }
  return `[inputGuard] ${parts.join(" ")}`;
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
 * It also decides whether a message is too long. A message over
 * `INPUT_GUARD_MAX_SCREEN_CHARS` is replaced whole with
 * `INPUT_GUARD_PLACEHOLDER`, without scanning it, and
 * {@link createInputRefusalMiddleware} refuses it. Keeping none of the text
 * means no part of a secret can reach a checkpoint, and the scan cost stays
 * bounded.
 *
 * "enforce" redacts and replaces. "monitor" logs what it would do and returns
 * the text unchanged. "off" returns the text unchanged. Each decision logs one
 * `[inputGuard]` line with the secret kinds or the length, never the text.
 */
export function createInputRedactor(
  mode: InputGuardMode,
): (text: string) => string {
  if (mode === "off") return (text) => text;
  const enforce = mode === "enforce";
  return (text) => {
    if (text.length > INPUT_GUARD_MAX_SCREEN_CHARS) {
      warn({ action: "refuse", would: !enforce, length: text.length });
      return enforce ? INPUT_GUARD_PLACEHOLDER : text;
    }
    const redacted = redactSecretText(text);
    if (redacted.kinds.length > 0) {
      warn({ action: "redact", would: !enforce, secrets: redacted.kinds });
    }
    return enforce ? redacted.text : text;
  };
}

/**
 * Refuses a user message the agent can't screen, before the model sees it.
 * This is a LangChain `beforeAgent` middleware, so it runs on the agent side
 * and covers every client. It skips approval resumes and turns whose last
 * message isn't from the user.
 *
 * It refuses a message that is `INPUT_GUARD_PLACEHOLDER` with a fixed reply
 * and ends the turn, so the model is not called. {@link createInputRedactor}
 * puts the placeholder in place of an over-limit message before the graph,
 * because LangGraph saves the input to its first checkpoints before any
 * middleware runs. That is also where the refusal is logged, with the real
 * length. Use the two together.
 *
 * Only `mode: "enforce"` refuses. "monitor" and "off" do nothing, since the
 * redactor only writes the placeholder in "enforce".
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

  return createMiddleware({
    name: "inputRefusal",
    beforeAgent: {
      canJumpTo: ["end"],
      hook: (state, runtime) => {
        if (mode !== "enforce" || isAgentEngineResume(runtime)) {
          return undefined;
        }

        const last = state.messages.at(-1);
        if (!HumanMessage.isInstance(last)) return undefined;
        if (last.content !== INPUT_GUARD_PLACEHOLDER) return undefined;

        return {
          messages: [new AIMessage(INPUT_GUARD_TOO_LONG)],
          jumpTo: "end" as const,
        };
      },
    },
  });
}
