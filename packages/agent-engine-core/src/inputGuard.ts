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
import { z } from "zod";

import { redactSecretText } from "./redactSecrets.js";
import type { InputGuardMode } from "./inputGuardConfig.js";
import { isAgentEngineResume } from "./stampResume.js";

export interface InputRefusalOptions {
  /** Defaults to "enforce". "monitor" logs without blocking or modifying. */
  mode?: InputGuardMode;
}

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
 * "enforce" redacts. "monitor" logs what it would redact and returns the text
 * unchanged. "off" returns the text unchanged. Each decision logs one
 * `[inputGuard]` line with the secret kinds, never the text.
 *
 * This runs on unbounded user input, so it scans at most
 * `INPUT_GUARD_MAX_SCREEN_CHARS + 1` characters. In "enforce" the rest is
 * dropped, so it never reaches a checkpoint. The message is still over the
 * limit, so {@link createInputRefusalMiddleware} refuses it. In "monitor" the
 * returned text is the original, and only the log reflects the truncated scan.
 */
export function createInputRedactor(
  mode: InputGuardMode,
): (text: string) => string {
  if (mode === "off") return (text) => text;
  const enforce = mode === "enforce";
  return (text) => {
    // This runs before the length check in the refusal middleware, on input
    // of any size, and the secret rules do work proportional to the text.
    // Capping the scan keeps that work bounded. One character past the limit
    // is enough: the refusal middleware still sees an over-limit message and
    // refuses it. In enforce mode the dropped tail is never returned, so it
    // never reaches a checkpoint.
    const scanned = text.slice(0, INPUT_GUARD_MAX_SCREEN_CHARS + 1);
    const redacted = redactSecretText(scanned);
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
 * Refuses a user message the agent can't screen, before the model sees it.
 * This is a LangChain `beforeAgent` middleware, so it runs on the agent side
 * and covers every client. It skips approval resumes and turns whose last
 * message isn't from the user.
 *
 * It refuses messages over `INPUT_GUARD_MAX_SCREEN_CHARS` with a fixed reply
 * and ends the turn. The model is not called, and the message in state is
 * replaced with a placeholder so it isn't resent on later turns.
 *
 * It does not redact secrets. That happens before the graph, in
 * {@link createInputRedactor}, because LangGraph saves the input to its first
 * checkpoints before any middleware runs.
 *
 * Each refusal logs one `[inputGuard]` line with the message length, never
 * the text. `mode: "monitor"` logs what would happen and changes nothing.
 * `mode: "off"` disables it.
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
        if (mode === "off" || isAgentEngineResume(runtime)) return undefined;

        const last = state.messages.at(-1);
        if (!HumanMessage.isInstance(last)) return undefined;

        const length = contentText(last.content).length;
        if (length <= INPUT_GUARD_MAX_SCREEN_CHARS) return undefined;

        const enforce = mode === "enforce";
        warn({ action: "refuse", would: !enforce, length });
        if (!enforce) return undefined;
        return {
          messages: [
            replacement(last, INPUT_GUARD_PLACEHOLDER),
            new AIMessage(INPUT_GUARD_TOO_LONG),
          ],
          jumpTo: "end" as const,
        };
      },
    },
  });
}
