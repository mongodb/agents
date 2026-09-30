import type {
  Adapter,
  Chat,
  Message,
  Thread,
} from "chat";

import {
  DEFAULT_REVIEW_APPROVE_ACTION_ID,
  DEFAULT_REVIEW_REJECT_ACTION_ID,
} from "./cards.js";
import { handleConversationMessage } from "./conversation.js";
import {
  clientUserFromAuthor,
  platformActorId,
  SLACK_CHAT_CLIENT,
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
  reviewApproveActionId?: string;
  reviewInterruptIdForAdapter?: (
    adapter: Adapter,
    value: string,
    threadId: string,
  ) => string | null;
  reviewRejectActionId?: string;
  store: ThreadStore;
}

interface ResolvedChatHandlerOptions extends ChatHandlerOptions {
  messages: AgentChatMessages;
  reviewApproveActionId: string;
  reviewRejectActionId: string;
}

function resolveHandlerOptions(
  options: ChatHandlerOptions,
): ResolvedChatHandlerOptions {
  return {
    ...options,
    messages: resolveAgentChatMessages(options.messages),
    reviewApproveActionId:
      options.reviewApproveActionId ?? DEFAULT_REVIEW_APPROVE_ACTION_ID,
    reviewRejectActionId:
      options.reviewRejectActionId ?? DEFAULT_REVIEW_REJECT_ACTION_ID,
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
    [resolved.reviewApproveActionId, resolved.reviewRejectActionId],
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
          client: SLACK_CHAT_CLIENT,
          user: clientUserFromAuthor(event.adapter.name, event.user),
          decision:
            event.actionId === resolved.reviewApproveActionId
              ? "approve"
              : "reject",
        },
        {
          agent: resolved.agent,
          botName: resolved.botName,
          conversation,
          messages: resolved.messages,
          reviewApproveActionId: resolved.reviewApproveActionId,
          reviewRejectActionId: resolved.reviewRejectActionId,
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
      client: SLACK_CHAT_CLIENT,
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
      reviewApproveActionId: options.reviewApproveActionId,
      reviewRejectActionId: options.reviewRejectActionId,
      store: options.store,
      ...(options.authorizedActorIds
        ? { authorizedActorIds: options.authorizedActorIds }
        : {}),
      ...(options.logger ? { logger: options.logger } : {}),
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
