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

import type { Thread } from "chat";

import { defaultAgentChatMessages } from "./messages.js";
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
  botName: string;
  delivery?: DeliveryBoundary;
  reviewMessageId?: string;
  reviewStatusUncertain?: string;
}

export function createConversationSurface(
  thread: Thread<unknown>,
  options: ConversationSurfaceOptions,
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
              reviewStatusText(
                status,
                options.botName,
                options.reviewStatusUncertain,
              ),
            );
          },
        }
      : {}),
  };
}

function reviewStatusText(
  status: "approved" | "rejected" | "uncertain",
  botName: string,
  reviewStatusUncertain: string = defaultAgentChatMessages.reviewStatusUncertain,
): string {
  return {
    approved:
      `Approved by the requester. ${botName} is continuing.`,
    rejected:
      `Rejected by the requester. ${botName} will not run this operation.`,
    uncertain: reviewStatusUncertain,
  }[status];
}
