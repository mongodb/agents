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
import type {
  AgentGateway,
  HandlerLogger,
} from "./types.js";
import type { ThreadStore } from "../store/threadStore.js";

export interface ChatHandlerOptions {
  agent: AgentGateway;
  authorizedActorIds?: ReadonlySet<string>;
  deliveryForAdapter?: (
    adapter: Adapter,
  ) => DeliveryBoundary | undefined;
  logger?: HandlerLogger;
  reviewInterruptIdForAdapter?: (
    adapter: Adapter,
    value: string,
    threadId: string,
  ) => string | null;
  store: ThreadStore;
}

export function registerChatHandlers(
  chat: Chat,
  options: ChatHandlerOptions,
): void {
  chat.onNewMention(async (thread, message) => {
    if (
      shouldIgnoreUnstructuredSlackMention(
        thread.adapter,
        message,
      )
    ) {
      options.logger?.warn?.(
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
      !options.authorizedActorIds ||
      options.authorizedActorIds.has(actorId)
    ) {
      await thread.subscribe();
    }
    await dispatchMessage(thread, message, options);
  });

  chat.onDirectMessage(async (thread, message) => {
    await dispatchMessage(thread, message, options);
  });

  chat.onSubscribedMessage(async (thread, message) => {
    if (
      shouldIgnoreSlackMessageAddressedToSomeoneElse(
        thread.adapter,
        message,
      )
    ) {
      options.logger?.warn?.(
        "Ignored Slack thread message addressed to another person",
        {
          messageId: message.id,
          threadId: thread.id,
        },
      );
      return;
    }
    await dispatchMessage(thread, message, options);
  });

  chat.onAction(
    [REVIEW_APPROVE_ACTION_ID, REVIEW_REJECT_ACTION_ID],
    async (event) => {
      if (!event.thread) {
        return;
      }
      const conversation = createConversationSurface(event.thread, {
        delivery: options.deliveryForAdapter?.(event.adapter),
        reviewMessageId: event.messageId,
      });
      const interruptId = event.value
        ? options.reviewInterruptIdForAdapter
          ? options.reviewInterruptIdForAdapter(
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
            event.actionId === REVIEW_APPROVE_ACTION_ID
              ? "approve"
              : "reject",
        },
        {
          agent: options.agent,
          conversation,
          store: options.store,
          ...(options.authorizedActorIds
            ? { authorizedActorIds: options.authorizedActorIds }
            : {}),
          ...(options.logger ? { logger: options.logger } : {}),
        },
      );
    },
  );
}

async function dispatchMessage(
  thread: Thread<unknown>,
  message: Message,
  options: ChatHandlerOptions,
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
      conversation: createConversationSurface(thread, {
        delivery: options.deliveryForAdapter?.(thread.adapter),
      }),
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
