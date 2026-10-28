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
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { SomeMessage } from "mongodb-assistant-eval/eval";

/**
 * ChatOpenAI on the Responses API (gpt-5/gpt-6 in buildLLM) returns `content`
 * as an array of blocks (reasoning, text, ...). Chat Completions returns a
 * string. Keep only text.
 */
export function contentToText(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((b) =>
      typeof b === "string"
        ? b
        : b.type === "text" && typeof b.text === "string"
          ? b.text
          : "",
    )
    .join("");
}

export function convertLangchainMessagesToAssistantEvalMessages(
  messages: BaseMessage[],
): SomeMessage[] {
  const out: SomeMessage[] = [];
  for (const m of messages) {
    if (HumanMessage.isInstance(m)) {
      out.push({ role: "user", content: contentToText(m.content) });
    } else if (AIMessage.isInstance(m)) {
      const toolCalls = (m.tool_calls ?? []).map((c) => ({
        id: c.id ?? "",
        type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
      }));
      out.push({
        role: "assistant",
        content: contentToText(m.content),
        ...(toolCalls.length ? { toolCalls } : {}),
      });
    } else if (ToolMessage.isInstance(m)) {
      out.push({
        role: "tool",
        content: contentToText(m.content),
        name: m.name,
        toolCallId: m.tool_call_id,
      });
    }
  }
  return out;
}
