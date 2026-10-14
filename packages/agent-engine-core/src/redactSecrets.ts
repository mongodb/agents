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
  pattern: RegExp;
  replace: string;
}

const SECRET_RULES: readonly SecretRule[] = [
  {
    kind: "private-key",
    pattern:
      /-----BEGIN (?:(?:RSA|EC|OPENSSH|ENCRYPTED|DSA) )?PRIVATE KEY-----[\s\S]*?-----END (?:(?:RSA|EC|OPENSSH|ENCRYPTED|DSA) )?PRIVATE KEY-----/g,
    replace: "[redacted-private-key]",
  },
  {
    kind: "mongodb-uri",
    pattern: /mongodb(\+srv)?:\/\/([^:\s/@]+):([^@\s]+)@/gi,
    replace: "mongodb$1://[redacted-username]:[redacted-password]@",
  },
  {
    kind: "atlas-service-account",
    pattern: /mdb_sa_sk_[A-Za-z0-9_-]+/g,
    replace: "mdb_sa_sk_[redacted-api-key]",
  },
  {
    kind: "api-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
    replace: "sk-[redacted-api-key]",
  },
];

export function redactSecretText(input: string): {
  text: string;
  kinds: string[];
} {
  const kinds: string[] = [];
  let text = input;
  for (const rule of SECRET_RULES) {
    const next = text.replace(rule.pattern, rule.replace);
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
