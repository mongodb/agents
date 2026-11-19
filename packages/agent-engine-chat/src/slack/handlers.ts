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

import type { SlackAdapter } from "@chat-adapter/slack";
import type { AppHomeOpenedEvent, Chat } from "chat";

import {
  registerChatHandlers,
  type ChatHandlerOptions,
} from "../chat/index.js";
import {
  registerSlackAppHomeHandler,
  type SlackHomeView,
} from "./appHome.js";
import { createSlackDeliveryBoundary } from "./delivery.js";
import { parseSlackReviewInterruptId } from "./review.js";

export interface SlackChatHandlerOptions extends Omit<
  ChatHandlerOptions,
  "deliveryForAdapter" | "reviewInterruptIdForAdapter"
> {
  adapter: SlackAdapter;
  buildHomeView?: (
    event: AppHomeOpenedEvent,
  ) => SlackHomeView | Promise<SlackHomeView>;
  maxMarkdownLength?: number;
  responseMetadataEvent: string;
}

export function registerSlackChatHandlers(
  chat: Chat,
  options: SlackChatHandlerOptions,
): void {
  const {
    adapter,
    buildHomeView,
    maxMarkdownLength,
    responseMetadataEvent,
    ...chatOptions
  } = options;
  const delivery = createSlackDeliveryBoundary(adapter, {
    responseMetadataEvent,
    ...(maxMarkdownLength !== undefined ? { maxMarkdownLength } : {}),
  });
  registerChatHandlers(chat, {
    ...chatOptions,
    deliveryForAdapter: (candidate) =>
      candidate.name === adapter.name ? delivery : undefined,
    reviewInterruptIdForAdapter: (candidate, value, threadId) =>
      candidate.name === adapter.name
        ? parseSlackReviewInterruptId(value, threadId)
        : value,
  });
  if (buildHomeView) {
    registerSlackAppHomeHandler(chat, adapter, buildHomeView);
  }
}
