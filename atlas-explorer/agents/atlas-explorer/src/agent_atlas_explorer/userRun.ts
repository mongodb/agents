import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { AgentInput, RequestContext } from "@magenta/sdk-core-ts";
import { getCurrentPayload } from "@magenta/runner-shared-ts";
import { createMiddleware } from "langchain";
import { z } from "zod";

const clientNameSchema = z
  .string()
  .min(1)
  .describe("Opaque name of the calling client, for example slack or msteams.");

export const clientUserSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Native user id from the calling client, for example a Slack U123."),
    username: z
      .string()
      .min(1)
      .optional()
      .describe("Handle from the calling client, when the client provided one."),
    full_name: z
      .string()
      .min(1)
      .optional()
      .describe("Display name from the calling client, when the client provided one."),
    actor_id: z
      .string()
      .min(1)
      .optional()
      .describe("Platform-qualified requester id, for example slack:U123."),
  })
  .refine((user) => user.id !== undefined || user.actor_id !== undefined, {
    message: "user must include id or actor_id",
  })
  .describe("Identity of the requester for a single Magenta invocation.");

const payloadExtrasSchema = z.object({
  client: clientNameSchema,
  user: clientUserSchema,
});

export type ClientUser = z.infer<typeof clientUserSchema>;
export type ClientUserExtras = { client: string; user: ClientUser };

const stampedRequestContexts = new WeakSet<object>();

function payloadRecord(input: AgentInput): Record<string, unknown> {
  const payload = input.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function currentPayload(): unknown {
  try {
    return getCurrentPayload();
  } catch {
    return null;
  }
}

function requestContextFromRuntime(
  runtime: { configurable?: Record<string, unknown> } | undefined,
): object | undefined {
  const ctx = runtime?.configurable?.["request_context"];
  if (ctx === null || typeof ctx !== "object" || Array.isArray(ctx)) {
    return undefined;
  }
  return ctx;
}

export function parseClientUserPayload(
  payload: unknown,
): ClientUserExtras | undefined {
  const parsed = payloadExtrasSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

export function isMagentaResume(
  runtime: { configurable?: Record<string, unknown> } | undefined,
): boolean {
  const ctx = requestContextFromRuntime(runtime);
  if (ctx === undefined) {
    return false;
  }
  return (ctx as { resume?: boolean }).resume === true;
}

export function stampClientUser(
  message: BaseMessage,
  extras: ClientUserExtras,
): BaseMessage {
  const additional_kwargs = {
    ...message.additional_kwargs,
    client: extras.client,
    user: extras.user,
  };

  if (AIMessage.isInstance(message)) {
    return new AIMessage({
      id: message.id,
      name: message.name,
      content: message.content,
      tool_calls: message.tool_calls,
      invalid_tool_calls: message.invalid_tool_calls,
      usage_metadata: message.usage_metadata,
      additional_kwargs,
      response_metadata: message.response_metadata,
    });
  }

  if (ToolMessage.isInstance(message)) {
    return new ToolMessage({
      id: message.id,
      name: message.name,
      content: message.content,
      tool_call_id: message.tool_call_id,
      status: message.status,
      artifact: message.artifact,
      additional_kwargs,
      response_metadata: message.response_metadata,
    });
  }

  if (HumanMessage.isInstance(message)) {
    return new HumanMessage({
      id: message.id,
      name: message.name,
      content: message.content,
      additional_kwargs,
      response_metadata: message.response_metadata,
    });
  }

  return message;
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
  runtime: { configurable?: Record<string, unknown> } | undefined,
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
 * Magenta graph input for a fresh invoke: the default HumanMessage, plus
 * client/user on that message when the payload includes them. Resume is
 * stamped separately by {@link stampResumeClientUserMiddleware}.
 */
export function prepareAtlasExplorerInput(
  input: AgentInput,
  ctx: Pick<RequestContext, "userId" | "sessionId">,
): Record<string, unknown> {
  const payload = payloadRecord(input);
  const extras = parseClientUserPayload(payload);
  const graphInput: Record<string, unknown> = {
    messages: [
      new HumanMessage({
        content: String(payload["message"] ?? ""),
        ...(extras
          ? {
              additional_kwargs: {
                client: extras.client,
                user: extras.user,
              },
            }
          : {}),
      }),
    ],
  };
  if (ctx.userId) {
    graphInput.user_id = ctx.userId;
  }
  if (ctx.sessionId) {
    graphInput.session_id = ctx.sessionId;
  }
  return graphInput;
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
