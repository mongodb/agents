import type { Thread } from "chat";

import type {
  ConversationSurface,
  DeliveryStatus,
} from "./types.js";

export interface DeliveryBoundary {
  deliver(
    thread: Thread<unknown>,
    text: string,
    deliveryId: string,
  ): Promise<void>;
  getDeliveryStatus(
    thread: Thread<unknown>,
    deliveryId: string,
  ): Promise<DeliveryStatus>;
}

interface ConversationSurfaceOptions {
  delivery?: DeliveryBoundary;
  reviewMessageId?: string;
}

export function createConversationSurface(
  thread: Thread<unknown>,
  options: ConversationSurfaceOptions = {},
): ConversationSurface {
  return {
    async post(message): Promise<void> {
      await thread.post(message);
    },

    async deliver(text, deliveryId): Promise<void> {
      if (options.delivery) {
        await options.delivery.deliver(thread, text, deliveryId);
        return;
      }
      await thread.post({ markdown: text });
    },

    async getDeliveryStatus(deliveryId): Promise<DeliveryStatus> {
      return options.delivery
        ? options.delivery.getDeliveryStatus(thread, deliveryId)
        : "unknown";
    },

    async setStatus(status): Promise<void> {
      await thread.startTyping(status);
    },

    ...(options.reviewMessageId
      ? {
          async updateReviewStatus(
            status: "approved" | "rejected" | "uncertain",
          ): Promise<void> {
            await thread.adapter.editMessage(
              thread.id,
              options.reviewMessageId!,
              reviewStatusText(status),
            );
          },
        }
      : {}),
  };
}

function reviewStatusText(
  status: "approved" | "rejected" | "uncertain",
): string {
  return {
    approved:
      "Approved by the requester. Atlas Explorer is continuing.",
    rejected:
      "Rejected by the requester. Atlas Explorer will not run this operation.",
    uncertain:
      "Decision submitted, but its outcome could not be confirmed. Check Atlas before retrying.",
  }[status];
}
