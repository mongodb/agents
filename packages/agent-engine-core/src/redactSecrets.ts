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
  type ContentBlock,
  type MessageContent,
} from "@langchain/core/messages";
import { createMiddleware } from "langchain";

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

function warnRedacted(kinds: readonly string[]): void {
  const unique = [...new Set(kinds)];
  console.warn(
    `[redactSecrets] Redacted ${unique.join(", ")} from assistant response`,
  );
}

/**
 * Remove common credentials from the model reply before it is checkpointed
 * or delivered. The warning names the pattern only.
 */
export const redactSecretsMiddleware = createMiddleware({
  name: "redactSecrets",
  wrapModelCall: async (request, handler) => {
    const message = await handler(request);
    if (!AIMessage.isInstance(message)) return message;

    const redacted = redactContent(message.content);
    if (redacted.kinds.length === 0) return message;

    message.content = redacted.content;
    warnRedacted(redacted.kinds);
    return message;
  },
});
