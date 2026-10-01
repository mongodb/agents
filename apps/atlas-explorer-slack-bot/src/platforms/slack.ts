import {
  createSlackAdapter,
  type SlackAdapter,
  type SlackAdapterMode,
} from "@chat-adapter/slack";
import type { Chat } from "chat";

import type { DeliveryBoundary } from "@repo/agent-engine-chat/chat";

const RESPONSE_METADATA_EVENT = "atlas_explorer_responded";
const MAX_SLACK_MARKDOWN_LENGTH = 12_000;

const SUGGESTED_PROMPTS = [
  {
    title: "List Atlas projects",
    message: "List the Atlas projects I can access.",
  },
  {
    title: "Inspect collections",
    message: "Show the collections in my MongoDB databases.",
  },
  {
    title: "Explain a query plan",
    message: "Help me understand and optimize a MongoDB query plan.",
  },
];

export interface SlackPlatformOptions {
  appToken?: string;
  botToken: string;
  displayName: string;
  mode: SlackAdapterMode;
  signingSecret?: string;
}

export function createSlackPlatformAdapter(
  options: SlackPlatformOptions,
): SlackAdapter {
  return createSlackAdapter({
    agentView: true,
    botToken: options.botToken,
    mode: options.mode,
    userName: options.displayName,
    suggestedPrompts: {
      title: "Explore MongoDB Atlas",
      prompts: SUGGESTED_PROMPTS,
    },
    sessionTitle: true,
    webClientOptions: {
      timeout: 30_000,
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
    },
    ...(options.appToken ? { appToken: options.appToken } : {}),
    ...(options.signingSecret
      ? { signingSecret: options.signingSecret }
      : {}),
  });
}

export function createSlackDeliveryBoundary(
  adapter: SlackAdapter,
): DeliveryBoundary {
  return {
    async deliver(thread, text, deliveryId): Promise<void> {
      const { channel, threadTs } = adapter.decodeThreadId(thread.id);
      const chunks = splitSlackResponse(text);
      const existingMarkers =
        chunks.length > 1
          ? await scanSlackDeliveryMarkers(
              adapter,
              channel,
              threadTs,
              deliveryId,
              chunks.length,
            )
          : undefined;
      if (existingMarkers?.delivered) {
        return;
      }

      for (const [index, chunk] of chunks.entries()) {
        const isFinalChunk = index === chunks.length - 1;
        if (
          !isFinalChunk &&
          existingMarkers?.chunkIndexes.has(index)
        ) {
          continue;
        }
        await adapter.webClient.chat.postMessage({
          channel,
          thread_ts: threadTs,
          markdown_text: chunk,
          ...(isFinalChunk
            ? {
                metadata: {
                  event_type: RESPONSE_METADATA_EVENT,
                  event_payload: { delivery_id: deliveryId },
                },
              }
            : {
                metadata: {
                  event_type: RESPONSE_METADATA_EVENT,
                  event_payload: {
                    delivery_id: chunkDeliveryMarker(
                      deliveryId,
                      index,
                      chunks.length,
                    ),
                  },
                },
              }),
        });
      }
    },

    async getDeliveryStatus(thread, deliveryId) {
      const { channel, threadTs } = adapter.decodeThreadId(thread.id);
      try {
        const markers = await scanSlackDeliveryMarkers(
          adapter,
          channel,
          threadTs,
          deliveryId,
        );
        return markers.delivered
          ? "delivered"
          : "not_delivered";
      } catch {
        return "unknown";
      }
    },
  };
}

async function scanSlackDeliveryMarkers(
  adapter: SlackAdapter,
  channel: string,
  threadTs: string,
  deliveryId: string,
  chunkCount?: number,
): Promise<{
  chunkIndexes: Set<number>;
  delivered: boolean;
}> {
  const chunkIndexes = new Set<number>();
  let cursor: string | undefined;
  let delivered = false;
  do {
    const page = await adapter.webClient.conversations.replies({
      channel,
      ts: threadTs,
      include_all_metadata: true,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const message of page.messages ?? []) {
      const metadata = message.metadata;
      const payload = metadata
        ?.event_payload as Record<string, unknown> | undefined;
      if (
        metadata?.event_type !== RESPONSE_METADATA_EVENT ||
        typeof payload?.delivery_id !== "string"
      ) {
        continue;
      }
      if (payload.delivery_id === deliveryId) {
        delivered = true;
      } else if (chunkCount !== undefined) {
        for (let index = 0; index < chunkCount - 1; index += 1) {
          if (
            payload.delivery_id ===
            chunkDeliveryMarker(deliveryId, index, chunkCount)
          ) {
            chunkIndexes.add(index);
            break;
          }
        }
      }
    }
    cursor =
      page.response_metadata?.next_cursor?.trim() || undefined;
  } while (cursor);
  return { chunkIndexes, delivered };
}

function chunkDeliveryMarker(
  deliveryId: string,
  chunkIndex: number,
  chunkCount: number,
): string {
  return `${deliveryId}:chunk:${chunkIndex}:${chunkCount}`;
}

export function registerSlackPlatformHandlers(
  chat: Chat,
  adapter: SlackAdapter,
  displayName: string,
): void {
  chat.onAppHomeOpened(async (event) => {
    if (event.adapter !== adapter || event.tab === "messages") {
      return;
    }
    await adapter.publishHomeView(
      event.userId,
      buildSlackHomeView(displayName),
    );
  });
}

function splitSlackResponse(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_SLACK_MARKDOWN_LENGTH) {
    const splitIndex = findSlackMarkdownSplitIndex(remaining);
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }
  chunks.push(remaining);
  return chunks;
}

function findSlackMarkdownSplitIndex(text: string): number {
  const paragraphStart = text.lastIndexOf(
    "\n\n",
    MAX_SLACK_MARKDOWN_LENGTH - 2,
  );
  const paragraphEnd =
    paragraphStart >= 0 ? paragraphStart + 2 : -1;

  let headingStart = -1;
  const headingPattern = /\n(?=#{1,6}[ \t])/g;
  const searchWindow = text.slice(
    0,
    MAX_SLACK_MARKDOWN_LENGTH + 1,
  );
  for (const match of searchWindow.matchAll(headingPattern)) {
    headingStart = match.index + 1;
  }

  const previousParagraphStart =
    paragraphStart > 0
      ? text.lastIndexOf("\n\n", paragraphStart - 1)
      : -1;
  if (
    headingStart > previousParagraphStart &&
    headingStart < paragraphEnd
  ) {
    return headingStart;
  }

  const naturalBoundary = Math.max(paragraphEnd, headingStart);
  if (naturalBoundary > 0) {
    return naturalBoundary;
  }

  const lineEnd = text.lastIndexOf(
    "\n",
    MAX_SLACK_MARKDOWN_LENGTH - 1,
  );
  const splitIndex = lineEnd >= 0
    ? lineEnd + 1
    : MAX_SLACK_MARKDOWN_LENGTH;
  const previousCodeUnit = text.charCodeAt(splitIndex - 1);
  const nextCodeUnit = text.charCodeAt(splitIndex);
  const splitsSurrogatePair =
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff;
  return splitsSurrogatePair ? splitIndex - 1 : splitIndex;
}

export function parseSlackReviewInterruptId(
  value: string,
  signedThreadId: string,
): string | null {
  if (!value.startsWith("{")) {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as {
      channelId?: unknown;
      interruptId?: unknown;
      threadTs?: unknown;
    };
    if (
      typeof parsed.channelId !== "string" ||
      !parsed.channelId ||
      typeof parsed.threadTs !== "string" ||
      !parsed.threadTs ||
      typeof parsed.interruptId !== "string" ||
      !parsed.interruptId ||
      `slack:${parsed.channelId}:${parsed.threadTs}` !==
        signedThreadId
    ) {
      return null;
    }
    return parsed.interruptId;
  } catch {
    return null;
  }
}

function buildSlackHomeView(displayName: string) {
  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Welcome to ${displayName}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Explore MongoDB databases and Atlas resources from Slack. Send a DM or mention this app in a channel, then keep follow-ups in the same thread.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Try asking:*\n• List the Atlas projects I can access\n• Show the collections in a database\n• Explain and optimize a MongoDB query plan",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "This demo uses the Atlas credentials configured on its shared Magenta workspace. Atlas access is not scoped to your chat identity.",
          },
        ],
      },
    ],
  };
}
