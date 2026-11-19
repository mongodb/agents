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

import type {
  Adapter,
  Chat,
  Message,
  Thread,
} from "chat";

import {
  REVIEW_APPROVE_ACTION_ID,
  REVIEW_REJECT_ACTION_ID,
} from "./cards.js";
import { handleConversationMessage } from "./conversation.js";
import {
  clientUserFromAuthor,
  platformActorId,
} from "./identity.js";
import { handleReviewDecision } from "./review.js";
import {
  createConversationSurface,
  type DeliveryBoundary,
} from "./surface.js";
import {
  shouldIgnoreSlackMessageAddressedToSomeoneElse,
  shouldIgnoreUnstructuredSlackMention,
} from "./slackMentions.js";
import {
  resolveAgentChatMessages,
  type AgentChatMessages,
} from "./messages.js";
import {
  assertValidSessionLimit,
  type SessionLimit,
} from "./sessionHealth.js";
import type {
  AgentGateway,
  HandlerLogger,
} from "./types.js";
import type { ThreadStore } from "../store/threadStore.js";

export interface ChatHandlerOptions {
  agent: AgentGateway;
  authorizedActorIds?: ReadonlySet<string>;
  botName: string;
  deliveryForAdapter?: (
    adapter: Adapter,
  ) => DeliveryBoundary | undefined;
  logger?: HandlerLogger;
  messages?: Partial<AgentChatMessages>;
  reviewInterruptIdForAdapter?: (
    adapter: Adapter,
    value: string,
    threadId: string,
  ) => string | null;
  /**
   * Caps how many agent sessions can be active within a rolling hour. Each
   * session uses Atlas MCP access tokens. Messages that would start a session
   * past the cap get a limit-reached reply instead. Leave unset for no cap.
   */
  sessionLimit?: SessionLimit;
  store: ThreadStore;
}

interface ResolvedChatHandlerOptions extends ChatHandlerOptions {
  messages: AgentChatMessages;
}

function resolveHandlerOptions(
  options: ChatHandlerOptions,
): ResolvedChatHandlerOptions {
  if (options.sessionLimit) {
    assertValidSessionLimit(options.sessionLimit);
  }
  return {
    ...options,
    messages: resolveAgentChatMessages(options.messages),
  };
}

export function registerChatHandlers(
  chat: Chat,
  options: ChatHandlerOptions,
): void {
  const resolved = resolveHandlerOptions(options);
  chat.onNewMention(async (thread, message) => {
    if (
      shouldIgnoreUnstructuredSlackMention(
        thread.adapter,
        message,
      )
    ) {
      resolved.logger?.warn?.(
        "Ignored Slack mention without this bot's user ID",
        {
          messageId: message.id,
          threadId: thread.id,
        },
      );
      return;
    }

    const actorId = actorIdFor(thread, message);
    if (
      !resolved.authorizedActorIds ||
      resolved.authorizedActorIds.has(actorId)
    ) {
      await thread.subscribe();
    }
    await dispatchMessage(thread, message, resolved);
  });

  chat.onDirectMessage(async (thread, message) => {
    await dispatchMessage(thread, message, resolved);
  });

  chat.onSubscribedMessage(async (thread, message) => {
    // Other bots' thread replies are only for us when they explicitly
    // mention this bot. Otherwise two co-subscribed bots would answer each
    // other's replies in a loop.
    if (
      message.author.isBot === true &&
      (!message.isMention ||
        shouldIgnoreUnstructuredSlackMention(thread.adapter, message))
    ) {
      return;
    }
    if (
      shouldIgnoreSlackMessageAddressedToSomeoneElse(
        thread.adapter,
        message,
      )
    ) {
      resolved.logger?.warn?.(
        "Ignored Slack thread message addressed to another person",
        {
          messageId: message.id,
          threadId: thread.id,
        },
      );
      return;
    }
    await dispatchMessage(thread, message, resolved);
  });

  chat.onAction(
    [REVIEW_APPROVE_ACTION_ID, REVIEW_REJECT_ACTION_ID],
    async (event) => {
      if (!event.thread) {
        return;
      }
      const conversation = createConversationSurface(event.thread, {
        botName: resolved.botName,
        delivery: resolved.deliveryForAdapter?.(event.adapter),
        reviewMessageId: event.messageId,
        reviewStatusUncertain: resolved.messages.reviewStatusUncertain,
      });
      const interruptId = event.value
        ? resolved.reviewInterruptIdForAdapter
          ? resolved.reviewInterruptIdForAdapter(
              event.adapter,
              event.value,
              event.threadId,
            )
          : event.value
        : null;
      if (!interruptId) {
        await conversation.post(
          "This approval button is invalid or expired.",
        );
        return;
      }
      await handleReviewDecision(
        {
          threadId: event.threadId,
          interruptId,
          actorId: platformActorId(
            event.adapter.name,
            event.user.userId,
          ),
          client: event.adapter.name,
          user: clientUserFromAuthor(event.adapter.name, event.user),
          decision:
            event.actionId === REVIEW_APPROVE_ACTION_ID
              ? "approve"
              : "reject",
        },
        {
          agent: resolved.agent,
          botName: resolved.botName,
          conversation,
          messages: resolved.messages,
          store: resolved.store,
          ...(resolved.authorizedActorIds
            ? { authorizedActorIds: resolved.authorizedActorIds }
            : {}),
          ...(resolved.logger ? { logger: resolved.logger } : {}),
        },
      );
    },
  );
}

async function dispatchMessage(
  thread: Thread<unknown>,
  message: Message,
  options: ResolvedChatHandlerOptions,
): Promise<void> {
  await handleConversationMessage(
    {
      threadId: thread.id,
      eventId: `${thread.adapter.name}:${message.id}`,
      actorId: actorIdFor(thread, message),
      authorIsBot: message.author.isBot === true,
      text: message.text,
      client: thread.adapter.name,
      user: clientUserFromAuthor(thread.adapter.name, message.author),
    },
    {
      agent: options.agent,
      botName: options.botName,
      conversation: createConversationSurface(thread, {
        botName: options.botName,
        delivery: options.deliveryForAdapter?.(thread.adapter),
        reviewStatusUncertain: options.messages.reviewStatusUncertain,
      }),
      messages: options.messages,
      store: options.store,
      ...(options.authorizedActorIds
        ? { authorizedActorIds: options.authorizedActorIds }
        : {}),
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.sessionLimit
        ? { sessionLimit: options.sessionLimit }
        : {}),
    },
  );
}

function actorIdFor(
  thread: Thread<unknown>,
  message: Message,
): string {
  return platformActorId(
    thread.adapter.name,
    message.author.userId,
  );
}
