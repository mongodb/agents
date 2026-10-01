import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
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

export function parseClientUserPayload(
  payload: unknown,
): ClientUserExtras | undefined {
  const parsed = payloadExtrasSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
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
