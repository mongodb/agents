import type { AdapterPostableMessage } from "chat";

import type { AgentChatMessages } from "./messages.js";
import type {
  InvocationProgressHandler,
  InvocationResult,
  InvokeInput,
  ResumeInput,
} from "../magenta/types.js";
import type { ThreadStore } from "../store/threadStore.js";

export type DeliveryStatus =
  | "delivered"
  | "not_delivered"
  | "unknown";

export interface AgentGateway {
  invoke(input: InvokeInput): Promise<InvocationResult>;
  invokeStream(
    input: InvokeInput,
    onProgress?: InvocationProgressHandler,
  ): Promise<InvocationResult>;
  resume(input: ResumeInput): Promise<InvocationResult>;
  resumeStream(
    input: ResumeInput,
    onProgress?: InvocationProgressHandler,
  ): Promise<InvocationResult>;
}

export interface ConversationSurface {
  deliver(text: string, deliveryId: string): Promise<void>;
  getDeliveryStatus(deliveryId: string): Promise<DeliveryStatus>;
  post(message: AdapterPostableMessage): Promise<void>;
  setStatus(status: string): Promise<void>;
  updateReviewStatus?(
    status: "approved" | "rejected" | "uncertain",
  ): Promise<void>;
}

export interface HandlerLogger {
  error(message: string, error: unknown): void;
  warn?(message: string, error: unknown): void;
}

export interface ChatHandlerDependencies {
  agent: AgentGateway;
  authorizedActorIds?: ReadonlySet<string>;
  botName: string;
  conversation: ConversationSurface;
  logger?: HandlerLogger;
  messages?: AgentChatMessages;
  now?: () => Date;
  store: ThreadStore;
}
