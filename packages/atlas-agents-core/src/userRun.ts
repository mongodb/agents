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

import { HumanMessage } from "@langchain/core/messages";
import type { AgentInput, RequestContext } from "@mongodb-js/agent-engine-sdk";

import { parseClientUserPayload, stampClientUser } from "./clientUser.js";

function payloadRecord(input: AgentInput): Record<string, unknown> {
  const payload = input.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

export interface PrepareAgentInputOptions {
  /**
   * Rewrites the message text before it enters the graph. LangGraph
   * checkpoints the input as given, so this is the only place to keep a
   * secret out of a thread's first checkpoints.
   */
  redactMessage?: (text: string) => string;
}

/**
 * Agent Engine graph input for a fresh invoke: the default HumanMessage, plus
 * client/user on that message when the payload includes them. Resume is
 * stamped separately in stampResume.ts.
 */
export function prepareAgentInput(
  input: AgentInput,
  ctx: Pick<RequestContext, "userId" | "sessionId">,
  options: PrepareAgentInputOptions = {},
): Record<string, unknown> {
  const payload = payloadRecord(input);
  const extras = parseClientUserPayload(payload);
  const text = String(payload["message"] ?? "");
  const human = new HumanMessage({
    content: options.redactMessage ? options.redactMessage(text) : text,
  });
  const graphInput: Record<string, unknown> = {
    messages: [extras ? stampClientUser(human, extras) : human],
  };
  if (ctx.userId) {
    graphInput.user_id = ctx.userId;
  }
  if (ctx.sessionId) {
    graphInput.session_id = ctx.sessionId;
  }
  return graphInput;
}
