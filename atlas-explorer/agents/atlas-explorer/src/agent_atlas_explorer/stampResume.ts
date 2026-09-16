import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { getCurrentPayload } from "@magenta/runner-shared-ts";
import { createMiddleware } from "langchain";

import {
  parseClientUserPayload,
  stampClientUser,
  type ClientUserExtras,
} from "./clientUser.js";

type AgentRuntime = { configurable?: Record<string, unknown> };

const stampedRequestContexts = new WeakSet<object>();

function currentPayload(): unknown {
  try {
    return getCurrentPayload();
  } catch {
    return null;
  }
}

function requestContextFromRuntime(
  runtime: AgentRuntime | undefined,
): object | undefined {
  const ctx = runtime?.configurable?.["request_context"];
  if (ctx === null || typeof ctx !== "object" || Array.isArray(ctx)) {
    return undefined;
  }
  return ctx;
}

export function isMagentaResume(runtime: AgentRuntime | undefined): boolean {
  const ctx = requestContextFromRuntime(runtime);
  if (ctx === undefined) {
    return false;
  }
  return (ctx as { resume?: boolean }).resume === true;
}

/**
 * Stamp the interrupted model turn (and any HITL reject tool messages after
 * it) so a resume can record a different approver than the original
 * requester.
 */
export function stampResumeMessages(
  messages: readonly BaseMessage[],
  extras: ClientUserExtras,
): { messages: BaseMessage[] } | undefined {
  let lastAi = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (AIMessage.isInstance(messages[i])) {
      lastAi = i;
      break;
    }
  }
  if (lastAi < 0) {
    return undefined;
  }

  const updates: BaseMessage[] = [];
  for (let i = lastAi; i < messages.length; i++) {
    updates.push(stampClientUser(messages[i]!, extras));
  }
  return { messages: updates };
}

function resumeStampTarget(
  runtime: AgentRuntime | undefined,
): { extras: ClientUserExtras; ctx: object } | undefined {
  if (!isMagentaResume(runtime)) {
    return undefined;
  }
  const ctx = requestContextFromRuntime(runtime);
  if (ctx === undefined || stampedRequestContexts.has(ctx)) {
    return undefined;
  }
  const extras = parseClientUserPayload(currentPayload());
  if (extras === undefined) {
    return undefined;
  }
  return { extras, ctx };
}

/**
 * Listed before HITL so afterModel runs after the interrupt resumes (approve).
 * wrapModelCall covers reject, which jumps back to the model and skips
 * remaining afterModel nodes.
 */
export const stampResumeClientUserMiddleware = createMiddleware({
  name: "stampResumeClientUser",
  afterModel: (state, runtime) => {
    const target = resumeStampTarget(runtime);
    if (target === undefined) {
      return undefined;
    }
    const update = stampResumeMessages(state.messages ?? [], target.extras);
    if (update === undefined) {
      return undefined;
    }
    stampedRequestContexts.add(target.ctx);
    return update;
  },
  wrapModelCall: async (request, handler) => {
    const response = await handler(request);
    const target = resumeStampTarget(request.runtime);
    if (target === undefined) {
      return response;
    }
    const update = stampResumeMessages(
      request.state.messages ?? request.messages ?? [],
      target.extras,
    );
    if (update === undefined) {
      return response;
    }
    stampedRequestContexts.add(target.ctx);
    return new Command({ update });
  },
});
