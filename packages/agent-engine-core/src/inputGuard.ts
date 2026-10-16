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
import { createPromptDefense } from "@stackone/defender";
import { createMiddleware } from "langchain";

import { redactContent } from "./redactSecrets.js";
import type { InputGuardMode } from "./inputGuardConfig.js";
import { isAgentEngineResume } from "./stampResume.js";

/**
 * Screens the user's message before the model sees it. This is a speed bump
 * for obvious prompt injection, not a security boundary: pattern filters are
 * bypassable. The structural controls (read-only roles, approval for writes,
 * the egress policy, the untrusted-data prompt rule) are what bound the
 * agents. PII is deliberately not handled, because emails, IPs and
 * timestamps are normal Atlas input.
 */

export interface InputGuardOptions {
  /** Defaults to "enforce". "monitor" logs without blocking or modifying. */
  mode?: InputGuardMode;
}

export interface InputScreenResult {
  /** Allowlisted pattern IDs that matched. Any entry blocks the message. */
  blockedBy: string[];
  /** Other pattern IDs and structural flags. Logged only. */
  flagged: string[];
}

export const INPUT_GUARD_REFUSAL =
  "I can't act on that message because it looks like an attempt to change " +
  "my instructions. Please rephrase your question about your MongoDB or " +
  "Atlas deployment.";

export const INPUT_GUARD_PLACEHOLDER =
  "[Message removed by the input guard]";

/**
 * Pattern IDs from @stackone/defender that block. This is an allowlist
 * instead of the library's "high" severity on purpose: several high-severity
 * patterns match ordinary Atlas prompts, for example `run_code` ("run this
 * command: db.stats()"), `execute_command`, `uncensored` (a bare
 * "unfiltered") and `repeat_back` ("repeat all queries ...").
 */
export const INPUT_GUARD_BLOCK_PATTERNS: ReadonlySet<string> = new Set([
  "ignore_previous",
  "disregard_previous",
  "forget_previous",
  "override_instructions",
  "you_are_now",
  "jailbreak_dan",
  "developer_mode",
  "role_system",
  "role_developer",
  "role_admin",
  "bypass_security",
  "disable_safety",
  "ignore_safety",
]);

/** The regex tier screens at most this many characters, head and tail. */
export const INPUT_GUARD_MAX_SCREEN_CHARS = 50_000;

type PromptDefense = ReturnType<typeof createPromptDefense>;

let defense: PromptDefense | undefined;

function getDefense(): PromptDefense {
  defense ??= createPromptDefense({
    enableTier1: true,
    enableTier2: false,
    enableTier3: false,
  });
  return defense;
}

function headAndTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n${text.slice(text.length - half)}`;
}

// The library strips zero-width space, joiner and BOM, but not the word
// joiner, invisible operators or soft hyphens.
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g;

/** Runs the regex tier. Synchronous, about a millisecond. */
export function screenUserInput(text: string): InputScreenResult {
  const visible = text.replace(INVISIBLE_CHARS, "");
  const result = getDefense().analyze(
    headAndTail(visible, INPUT_GUARD_MAX_SCREEN_CHARS),
  );
  const blockedBy = new Set<string>();
  const flagged = new Set<string>();
  if (visible.length !== text.length) flagged.add("invisible_unicode");
  for (const match of result.matches) {
    if (INPUT_GUARD_BLOCK_PATTERNS.has(match.pattern)) {
      blockedBy.add(match.pattern);
    } else {
      flagged.add(match.pattern);
    }
  }
  for (const flag of result.structuralFlags) {
    flagged.add(`structural:${flag.type}`);
  }
  return { blockedBy: [...blockedBy], flagged: [...flagged] };
}

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

        const redacted = redactContent(last.content);
        const text = contentText(redacted.content);
        const enforce = mode === "enforce";
        if (redacted.kinds.length > 0) {
          warn(
            `${enforce ? "redacted" : "would redact"} ` +
              `secrets=${[...new Set(redacted.kinds)].join(",")}`,
          );
        }
        if (text.trim().length === 0) return undefined;

        const screen = screenUserInput(text);
        if (screen.flagged.length > 0) {
          warn(`flagged rules=${screen.flagged.join(",")} length=${text.length}`);
        }

        const blockedBy = screen.blockedBy;

        if (blockedBy.length > 0) {
          warn(
            `${enforce ? "blocked" : "would block"} stage=regex ` +
              `rules=${blockedBy.join(",")} length=${text.length}`,
          );
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
