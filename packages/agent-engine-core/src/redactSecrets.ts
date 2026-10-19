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
  ToolMessage,
  type ContentBlock,
  type MessageContent,
} from "@langchain/core/messages";
import { Command, isCommand } from "@langchain/langgraph";
import { createMiddleware } from "langchain";
import { z } from "zod";

interface SecretRule {
  kind: string;
  redact: (text: string) => string;
}

function regexRule(
  kind: string,
  pattern: RegExp,
  replace: string,
): SecretRule {
  return { kind, redact: (text) => text.replace(pattern, replace) };
}

const PEM_KEY_LABEL = "(?:(?:RSA|EC|OPENSSH|ENCRYPTED|DSA) )?PRIVATE KEY";

/**
 * Redacts PEM private key blocks. One regex with a lazy `[\s\S]*?` body
 * rescans to the end of the text for every BEGIN header that has no END, which
 * is quadratic on repeated unmatched headers. Finding the headers and their
 * END markers separately is linear. Once no END marker exists after a header,
 * none exists after any later header either, so the scan stops.
 */
function redactPrivateKeys(text: string): string {
  const begin = new RegExp(`-----BEGIN ${PEM_KEY_LABEL}-----`, "g");
  const end = new RegExp(`-----END ${PEM_KEY_LABEL}-----`, "g");
  let out = "";
  let cursor = 0;
  for (;;) {
    const header = begin.exec(text);
    if (header === null) break;
    end.lastIndex = header.index + header[0].length;
    const footer = end.exec(text);
    if (footer === null) break;
    out += text.slice(cursor, header.index) + "[redacted-private-key]";
    cursor = footer.index + footer[0].length;
    begin.lastIndex = cursor;
  }
  return out + text.slice(cursor);
}

/**
 * Redacts the credentials in MongoDB URIs, keeping the scheme and host. The
 * single-regex form (`mongodb://user:password@`) rescans a long password run
 * for every `mongodb://` it contains, which is quadratic. Matching in steps
 * is linear: when a user and colon match but no `@` follows before whitespace,
 * no later start inside that run can match either, so the scan skips past it.
 */
function redactMongoDbUris(text: string): string {
  const scheme = /mongodb(\+srv)?:\/\//gi;
  const userAndColon = /[^:\s/@]+:/y;
  const passwordAndAt = /[^@\s]+@/y;
  const runEnd = /[\s@]/g;
  let out = "";
  let cursor = 0;
  for (;;) {
    const start = scheme.exec(text);
    if (start === null) break;
    const userStart = start.index + start[0].length;
    userAndColon.lastIndex = userStart;
    const user = userAndColon.exec(text);
    if (user === null) continue;
    const passwordStart = userStart + user[0].length;
    passwordAndAt.lastIndex = passwordStart;
    const password = passwordAndAt.exec(text);
    if (password === null) {
      runEnd.lastIndex = passwordStart;
      scheme.lastIndex = runEnd.exec(text)?.index ?? text.length;
      continue;
    }
    out +=
      text.slice(cursor, start.index) +
      `mongodb${start[1] ?? ""}://[redacted-username]:[redacted-password]@`;
    cursor = passwordStart + password[0].length;
    scheme.lastIndex = cursor;
  }
  return out + text.slice(cursor);
}

/**
 * The private key and MongoDB URI rules are hand-written scanners, not
 * regexes, so they run in linear time on crafted input (see the comments on
 * each). That matters because they run on unbounded user messages in
 * `createInputRedactor`, as well as on model replies and tool results. The
 * input redactor also skips messages over the input limit, as a second bound.
 */
const SECRET_RULES: readonly SecretRule[] = [
  { kind: "private-key", redact: redactPrivateKeys },
  { kind: "mongodb-uri", redact: redactMongoDbUris },
  regexRule(
    "atlas-service-account",
    /mdb_sa_sk_[A-Za-z0-9_-]+/g,
    "mdb_sa_sk_[redacted-api-key]",
  ),
  regexRule(
    "api-key",
    /\bsk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
    "sk-[redacted-api-key]",
  ),
];

export function redactSecretText(input: string): {
  text: string;
  kinds: string[];
} {
  const kinds: string[] = [];
  let text = input;
  for (const rule of SECRET_RULES) {
    const next = rule.redact(text);
    if (next !== text) {
      kinds.push(rule.kind);
      text = next;
    }
  }
  return { text, kinds };
}

function redactBlockField(
  block: ContentBlock,
  field: "text" | "reasoning",
): { block: ContentBlock; kinds: string[] } {
  if (!(field in block)) return { block, kinds: [] };
  const value = block[field];
  if (typeof value !== "string") return { block, kinds: [] };
  const result = redactSecretText(value);
  if (result.text === value) return { block, kinds: result.kinds };
  return { block: { ...block, [field]: result.text }, kinds: result.kinds };
}

function redactContent(content: MessageContent): {
  content: MessageContent;
  kinds: string[];
} {
  if (typeof content === "string") {
    const result = redactSecretText(content);
    return { content: result.text, kinds: result.kinds };
  }

  const kinds: string[] = [];
  const blocks = content.map((block) => {
    const text = redactBlockField(block, "text");
    const reasoning = redactBlockField(text.block, "reasoning");
    kinds.push(...text.kinds, ...reasoning.kinds);
    return reasoning.block;
  });
  return { content: blocks, kinds };
}

function redactAIMessage(message: AIMessage): {
  message: AIMessage;
  kinds: string[];
} {
  const redacted = redactContent(message.content);
  if (redacted.kinds.length === 0) {
    return { message, kinds: [] };
  }
  return {
    message: new AIMessage({
      id: message.id,
      name: message.name,
      content: redacted.content,
      tool_calls: message.tool_calls,
      invalid_tool_calls: message.invalid_tool_calls,
      usage_metadata: message.usage_metadata,
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata,
    }),
    kinds: redacted.kinds,
  };
}

function redactToolMessage(message: ToolMessage): {
  message: ToolMessage;
  kinds: string[];
} {
  const redacted = redactContent(message.content);
  if (redacted.kinds.length === 0) {
    return { message, kinds: [] };
  }
  return {
    message: new ToolMessage({
      id: message.id,
      name: message.name,
      content: redacted.content,
      tool_call_id: message.tool_call_id,
      status: message.status,
      // Passed through without deep traversal: none of our tools use
      // responseFormat: "content_and_artifact", matching how AIMessage
      // metadata fields (tool_calls, additional_kwargs) are handled above.
      artifact: message.artifact,
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata,
    }),
    kinds: redacted.kinds,
  };
}

const commandUpdateSchema = z
  .object({
    messages: z.array(z.unknown()),
  })
  .passthrough();

function redactCommandToolMessages(command: Command): {
  command: Command;
  kinds: string[];
} {
  const parsed = commandUpdateSchema.safeParse(command.update);
  if (!parsed.success) {
    return { command, kinds: [] };
  }

  const kinds: string[] = [];
  const messages = parsed.data.messages.map((entry) => {
    if (!ToolMessage.isInstance(entry)) return entry;
    const redacted = redactToolMessage(entry);
    kinds.push(...redacted.kinds);
    return redacted.message;
  });

  if (kinds.length === 0) {
    return { command, kinds: [] };
  }

  return {
    command: new Command({
      graph: command.graph,
      update: { ...parsed.data, messages },
      resume: command.resume,
      goto: command.goto,
    }),
    kinds,
  };
}

function redactToolCallResult(result: ToolMessage | Command): {
  result: ToolMessage | Command;
  kinds: string[];
} {
  if (ToolMessage.isInstance(result)) {
    const redacted = redactToolMessage(result);
    return { result: redacted.message, kinds: redacted.kinds };
  }
  if (isCommand(result)) {
    const redacted = redactCommandToolMessages(result);
    return { result: redacted.command, kinds: redacted.kinds };
  }
  return { result, kinds: [] };
}

function warnRedacted(
  kinds: readonly string[],
  source: "assistant response" | "tool message" = "assistant response",
): void {
  const unique = [...new Set(kinds)];
  console.warn(
    `[redactSecrets] Redacted ${unique.join(", ")} from ${source}`,
  );
}

/**
 * Remove common credentials from the model reply or tool message before it is
 * checkpointed or delivered. The warning names the pattern only.
 */
export const redactSecretsMiddleware = createMiddleware({
  name: "redactSecrets",
  wrapModelCall: async (request, handler) => {
    const message = await handler(request);
    if (!AIMessage.isInstance(message)) return message;

    const redacted = redactAIMessage(message);
    if (redacted.kinds.length > 0) {
      warnRedacted(redacted.kinds, "assistant response");
    }
    return redacted.message;
  },
  wrapToolCall: async (request, handler) => {
    const result = await handler(request);
    const redacted = redactToolCallResult(result);
    if (redacted.kinds.length > 0) {
      warnRedacted(redacted.kinds, "tool message");
    }
    return redacted.result;
  },
});
