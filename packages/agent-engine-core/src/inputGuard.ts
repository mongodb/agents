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

export interface InputGuardOptions {
  /** Defaults to "enforce". "monitor" logs without blocking or modifying. */
  mode?: InputGuardMode;
  /** Defaults to true. False skips the injection patterns. */
  regex?: boolean;
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

/**
 * Messages longer than this many characters are refused instead of screened.
 * The regex tier reads the full text in windows below this limit.
 */
export const INPUT_GUARD_MAX_SCREEN_CHARS = 100_000;

/** The refusal reply for a message over `INPUT_GUARD_MAX_SCREEN_CHARS`. */
export const INPUT_GUARD_TOO_LONG =
  "I can't act on that message because it is too long for me to screen. " +
  "Please split it into smaller parts and send them separately.";

/** The library truncates analysis to its first 50,000 characters. */
const LIBRARY_ANALYSIS_CHARS = 50_000;

/** Windows overlap by this many characters so patterns spanning a boundary are caught. */
const WINDOW_OVERLAP_CHARS = 1_000;

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

// The library strips zero-width space, joiner and BOM, but not the word
// joiner, invisible operators or soft hyphens.
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g;

/**
 * Runs the regex tier. Synchronous, a few milliseconds: the library reads at
 * most `LIBRARY_ANALYSIS_CHARS` characters per call, so text above that is
 * screened in overlapping windows. `text` must not exceed
 * `INPUT_GUARD_MAX_SCREEN_CHARS`; the middleware refuses longer messages.
 */
export function screenUserInput(text: string): InputScreenResult {
  const visible = text.replace(INVISIBLE_CHARS, "");
  const blockedBy = new Set<string>();
  const flagged = new Set<string>();
  if (visible.length !== text.length) flagged.add("invisible_unicode");
  const record = (result: ReturnType<PromptDefense["analyze"]>) => {
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
  };
  for (
    let start = 0;
    start < visible.length;
    start += LIBRARY_ANALYSIS_CHARS - WINDOW_OVERLAP_CHARS
  ) {
    record(
      getDefense().analyze(visible.slice(start, start + LIBRARY_ANALYSIS_CHARS)),
    );
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

/**
 * Screens the latest user message before the model sees it. This is a
 * LangChain `beforeAgent` middleware, so it runs on the agent side and covers
 * every client. It skips approval
 * resumes and turns whose last message isn't from the user.
 *
 * For each message it runs these steps in order:
 *
 * 1. Redacts pasted secrets: connection strings with passwords, `mdb_sa_sk_`
 *    and `sk-` keys, and private keys. It uses the same rules as the redaction
 *    of model replies. The model and the checkpoint only see the redacted text.
 * 2. Blocks known injection phrases with the Tier 1 regex patterns of
 *    `@stackone/defender`, after stripping invisible characters. Tier 1 also
 *    normalizes Unicode, homoglyphs and leet-speak. It blocks attempts to:
 *    - ignore, disregard, forget or override earlier instructions;
 *    - reassign the assistant's role ("you are now ...", DAN, developer mode);
 *    - pose as a system, developer or admin message;
 *    - bypass or disable security and safety rules.
 *
 * Step 2 blocks only on the pattern IDs in `INPUT_GUARD_BLOCK_PATTERNS`, not
 * on the library's "high" severity, because several high-severity patterns
 * match ordinary Atlas prompts. Other matches are logged and allowed. Set
 * `regex: false` to skip step 2.
 *
 * A blocked message gets a fixed refusal. The model is not called, and the
 * message in state becomes a placeholder so later turns don't replay it. Each
 * decision logs one `[inputGuard]` line with rule IDs and the message length,
 * never the text. `mode: "monitor"` logs what would happen and changes
 * nothing. `mode: "off"` disables the guard.
 *
 * Limits:
 * - It is a speed bump, not a security boundary, because pattern filters can
 *   be bypassed. The structural controls (read-only roles, approval for
 *   writes, the egress policy and the untrusted-data prompt rule) bound the
 *   agents.
 * - It does not redact PII. Emails, IPs, timestamps and ObjectIds are normal
 *   Atlas input.
 * - It does not screen tool output, so indirect injection through documents,
 *   `$comment` values and logs is not covered.
 * - The patterns are English-centric, and messages over 50,000 characters are
 *   screened in full; messages over 100,000 characters are refused.
 *
 * `@stackone/defender` is pinned to an exact version. `screenUserInput` wraps
 * it so a small in-repo rule list could replace it. The agents' esbuild
 * commands mark its optional ML peers external, because only the unused
 * Tier 2 imports them.
 */
export function createInputGuardMiddleware(options: InputGuardOptions = {}) {
  const mode = options.mode ?? "enforce";
  const regex = options.regex ?? true;

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

        let blockedBy: string[] = [];
        if (regex) {
          const screen = screenUserInput(text);
          if (screen.flagged.length > 0) {
            warn(
              `flagged rules=${screen.flagged.join(",")} length=${text.length}`,
            );
          }
          blockedBy = screen.blockedBy;
        }

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
