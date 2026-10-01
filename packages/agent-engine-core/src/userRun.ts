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

/**
 * Magenta graph input for a fresh invoke: the default HumanMessage, plus
 * client/user on that message when the payload includes them. Resume is
 * stamped separately in stampResume.ts.
 */
export function prepareAgentInput(
  input: AgentInput,
  ctx: Pick<RequestContext, "userId" | "sessionId">,
): Record<string, unknown> {
  const payload = payloadRecord(input);
  const extras = parseClientUserPayload(payload);
  const human = new HumanMessage({
    content: String(payload["message"] ?? ""),
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
