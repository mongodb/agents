import type { AdapterPostableMessage } from "chat";

import type {
  InvocationProgress,
  InvocationProgressHandler,
  InvocationResult,
  InvokeInput,
  ResumeInput,
} from "../magenta/types.js";
import type { ThreadStore } from "../store/threadStore.js";
import type {
  AgentGateway,
  ConversationSurface,
  DeliveryStatus,
} from "./types.js";

export const slackAdaClientUser = {
  client: "slack" as const,
  user: {
    id: "U123",
    username: "ada",
    full_name: "Ada Lovelace",
    actor_id: "slack:U123",
  },
};

export class FakeAgentGateway implements AgentGateway {
  invokeInputs: InvokeInput[] = [];
  resumeInputs: ResumeInput[] = [];
  progressEvents: InvocationProgress[] = [];
  invokeResult!: InvocationResult;
  resumeResult!: InvocationResult;
  invokeError?: unknown;
  resumeError?: unknown;

  async invoke(input: InvokeInput): Promise<InvocationResult> {
    this.invokeInputs.push(input);
    if (this.invokeError) {
      throw this.invokeError;
    }
    return this.invokeResult;
  }

  async resume(input: ResumeInput): Promise<InvocationResult> {
    this.resumeInputs.push(input);
    if (this.resumeError) {
      throw this.resumeError;
    }
    return this.resumeResult;
  }

  async invokeStream(
    input: InvokeInput,
    onProgress?: InvocationProgressHandler,
  ): Promise<InvocationResult> {
    this.invokeInputs.push(input);
    if (this.invokeError) {
      throw this.invokeError;
    }
    for (const progress of this.progressEvents) {
      await onProgress?.(progress);
    }
    return this.invokeResult;
  }

  async resumeStream(
    input: ResumeInput,
    onProgress?: InvocationProgressHandler,
  ): Promise<InvocationResult> {
    this.resumeInputs.push(input);
    for (const progress of this.progressEvents) {
      await onProgress?.(progress);
    }
    if (this.resumeError) {
      throw this.resumeError;
    }
    return this.resumeResult;
  }
}

export class FakeConversation implements ConversationSurface {
  statuses: string[] = [];
  messages: AdapterPostableMessage[] = [];
  agentResponses: string[] = [];
  deliveryIds = new Set<string>();
  deliveryAttempts = 0;
  deliveryError?: Error;
  acceptDeliveryBeforeError = false;
  deliveryGate?: Promise<void>;
  unknownDeliveryStatus = false;
  reviewStatuses: Array<"approved" | "rejected" | "uncertain"> = [];

  async setStatus(status: string): Promise<void> {
    this.statuses.push(status);
  }

  async post(message: AdapterPostableMessage): Promise<void> {
    this.messages.push(message);
  }

  async deliver(text: string, deliveryId: string): Promise<void> {
    this.deliveryAttempts += 1;
    await this.deliveryGate;
    if (this.deliveryError) {
      if (this.acceptDeliveryBeforeError) {
        this.agentResponses.push(text);
        this.deliveryIds.add(deliveryId);
      }
      throw this.deliveryError;
    }
    this.agentResponses.push(text);
    this.deliveryIds.add(deliveryId);
  }

  async getDeliveryStatus(
    deliveryId: string,
  ): Promise<DeliveryStatus> {
    if (this.unknownDeliveryStatus) {
      return "unknown";
    }
    return this.deliveryIds.has(deliveryId)
      ? "delivered"
      : "not_delivered";
  }

  async updateReviewStatus(
    status: "approved" | "rejected" | "uncertain",
  ): Promise<void> {
    this.reviewStatuses.push(status);
  }
}

export const completed: Extract<
  InvocationResult,
  { kind: "completed" }
> = {
  kind: "completed",
  response: "There are three projects.",
  sessionId: "session-1",
  executionId: "execution-1",
};

export function callingTool(toolName: string): InvocationProgress {
  return {
    content: `Calling tool: ${toolName}...`,
    phase: "tool_start",
    toolName,
  };
}

export const suspended: Extract<
  InvocationResult,
  { kind: "suspended" }
> = {
  kind: "suspended",
  sessionId: "session-1",
  executionId: "execution-2",
  interrupts: [
    {
      id: "interrupt-1",
      actionRequests: [
        {
          name: "mongodb__insert_many",
          args: {
            database: "inventory",
            collection: "items",
            documents: [{ sku: "A-1" }],
          },
          description: "MongoDB or Atlas operation pending approval",
        },
      ],
    },
  ],
  resumeSchema: { type: "object" },
};

export async function seedPendingReview(
  store: ThreadStore,
): Promise<void> {
  await store.put({
    threadId: "slack:C123:1720000000.000100",
    magentaSessionId: "session-1",
    pendingExecutionId: "execution-2",
    pendingInterruptId: "interrupt-1",
    pendingResumeSchema: { type: "object" },
    pendingActionRequests: [
      { name: "mongodb__insert_many", args: { count: 1 } },
      { name: "mongodb__create_index", args: { name: "sku_1" } },
    ],
    pendingRequestedByActorId: "slack:U123",
    updatedAt: new Date(),
  });
}
