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

import { createMiddleware } from "langchain";

function stripEchoedTools(message: {
  response_metadata: Record<string, unknown>;
}): void {
  if (!("tools" in message.response_metadata)) return;

  const metadata = { ...message.response_metadata };
  delete metadata.tools;
  message.response_metadata = metadata;
}

/**
 * OpenAI Responses echoes the complete bound-tool array in response metadata.
 * Keeping that copy on every AIMessage makes durable sessions grow by roughly
 * one tool catalog per turn. Clean both historical and new messages so existing
 * sessions can recover and future checkpoints remain compact.
 */
export const stripToolEchoMiddleware = createMiddleware({
  name: "stripOpenAIToolEcho",
  wrapModelCall: async (request, handler) => {
    request.messages.forEach(stripEchoedTools);
    const message = await handler(request);
    stripEchoedTools(message);
    return message;
  },
});
