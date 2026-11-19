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

import type { DeliveryBoundary } from "../chat/index.js";

export const MAX_SLACK_MARKDOWN_LENGTH = 12_000;

export interface SlackDeliveryBoundaryOptions {
  responseMetadataEvent: string;
  maxMarkdownLength?: number;
}

export function createSlackDeliveryBoundary(
  adapter: SlackAdapter,
  options: SlackDeliveryBoundaryOptions,
): DeliveryBoundary {
  const responseMetadataEvent = options.responseMetadataEvent.trim();
  if (!responseMetadataEvent) {
    throw new Error("responseMetadataEvent must be a non-empty string");
  }
  const maxMarkdownLength =
    options.maxMarkdownLength ?? MAX_SLACK_MARKDOWN_LENGTH;
  assertValidMaxMarkdownLength(maxMarkdownLength);

  return {
    async deliver(thread, text, deliveryId): Promise<void> {
      const { channel, threadTs } = adapter.decodeThreadId(thread.id);
      const chunks = splitSlackResponse(text, maxMarkdownLength);
      const existingMarkers =
        chunks.length > 1
          ? await scanSlackDeliveryMarkers(
              adapter,
              channel,
              threadTs,
              deliveryId,
              responseMetadataEvent,
              chunks.length,
            )
          : undefined;
      if (existingMarkers?.delivered) {
        return;
      }

      for (const [index, chunk] of chunks.entries()) {
        const isFinalChunk = index === chunks.length - 1;
        if (!isFinalChunk && existingMarkers?.chunkIndexes.has(index)) {
          continue;
        }
        await adapter.webClient.chat.postMessage({
          channel,
          thread_ts: threadTs,
          markdown_text: chunk,
          metadata: {
            event_type: responseMetadataEvent,
            event_payload: {
              delivery_id: isFinalChunk
                ? deliveryId
                : chunkDeliveryMarker(deliveryId, index, chunks.length),
            },
          },
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
          responseMetadataEvent,
        );
        return markers.delivered ? "delivered" : "not_delivered";
      } catch {
        return "unknown";
      }
    },
  };
}

export function splitSlackResponse(
  text: string,
  maxLength: number = MAX_SLACK_MARKDOWN_LENGTH,
): string[] {
  assertValidMaxMarkdownLength(maxLength);
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const splitIndex = findSlackMarkdownSplitIndex(remaining, maxLength);
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }
  chunks.push(remaining);
  return chunks;
}

async function scanSlackDeliveryMarkers(
  adapter: SlackAdapter,
  channel: string,
  threadTs: string,
  deliveryId: string,
  responseMetadataEvent: string,
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
      const payload = metadata?.event_payload as
        | Record<string, unknown>
        | undefined;
      if (
        metadata?.event_type !== responseMetadataEvent ||
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
    cursor = page.response_metadata?.next_cursor?.trim() || undefined;
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

function assertValidMaxMarkdownLength(maxLength: number): void {
  if (
    !Number.isInteger(maxLength) ||
    maxLength < 2 ||
    maxLength > MAX_SLACK_MARKDOWN_LENGTH
  ) {
    throw new RangeError(
      `maxLength must be an integer between 2 and ${MAX_SLACK_MARKDOWN_LENGTH}`,
    );
  }
}

function findSlackMarkdownSplitIndex(
  text: string,
  maxLength: number,
): number {
  const paragraphStart = text.lastIndexOf("\n\n", maxLength - 2);
  const paragraphEnd = paragraphStart >= 0 ? paragraphStart + 2 : -1;

  let headingStart = -1;
  const headingPattern = /\n(?=#{1,6}[ \t])/g;
  const searchWindow = text.slice(0, maxLength + 1);
  for (const match of searchWindow.matchAll(headingPattern)) {
    headingStart = match.index + 1;
  }

  const previousParagraphStart =
    paragraphStart > 0 ? text.lastIndexOf("\n\n", paragraphStart - 1) : -1;
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

  const lineEnd = text.lastIndexOf("\n", maxLength - 1);
  const splitIndex = lineEnd >= 0 ? lineEnd + 1 : maxLength;
  const previousCodeUnit = text.charCodeAt(splitIndex - 1);
  const nextCodeUnit = text.charCodeAt(splitIndex);
  const splitsSurrogatePair =
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff;
  return splitsSurrogatePair ? splitIndex - 1 : splitIndex;
}
