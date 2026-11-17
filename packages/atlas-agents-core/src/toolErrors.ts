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

import { ToolMessage } from "@langchain/core/messages";
import { isGraphInterrupt } from "@langchain/langgraph";
import { createMiddleware } from "langchain";

import { redactSecretText } from "./redactSecrets.js";

interface ToolCallRequest {
  toolCall?: {
    id?: string;
    name: string;
  };
}

export function formatToolErrorForAgent(
  toolName: string,
  error: unknown,
): string {
  const { text: detail } = redactSecretText(
    error instanceof Error ? error.message : String(error),
  );
  return (
    `Tool "${toolName}" failed. Do not stop the task. Read the error, ` +
    `correct the tool arguments, and retry.\n\n${detail}`
  );
}

export async function recoverToolCall<T>(
  request: ToolCallRequest,
  handler: () => T | Promise<T>,
): Promise<T | ToolMessage> {
  try {
    return await handler();
  } catch (error) {
    if (isGraphInterrupt(error)) throw error;

    const toolCall = request.toolCall;
    if (!toolCall?.id) throw error;

    return new ToolMessage({
      content: formatToolErrorForAgent(toolCall.name, error),
      tool_call_id: toolCall.id,
      name: toolCall.name,
      status: "error",
    });
  }
}

export const recoverToolErrorsMiddleware = createMiddleware({
  name: "recoverToolErrors",
  wrapToolCall: async (request, handler) =>
    recoverToolCall(request, () => handler(request)),
});
