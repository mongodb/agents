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
import type { Thread } from "chat";
import { describe, expect, it, vi } from "vitest";

import {
  createSlackDeliveryBoundary,
  MAX_SLACK_MARKDOWN_LENGTH,
  splitSlackResponse,
} from "./delivery.js";

describe("Slack response splitting", () => {
  it("exports the 12,000-character Slack markdown limit", () => {
    expect(MAX_SLACK_MARKDOWN_LENGTH).toBe(12_000);
  });

  it("prefers splitting before a heading inside the trailing paragraph", () => {
    const intro = "a".repeat(15);
    const heading = "## Section";
    const body = "b".repeat(8);
    const text = `${intro}\n\n${heading}\n${body}\n\nmore`;

    const chunks = splitSlackResponse(text, 40);

    expect(chunks).toEqual([
      `${intro}\n\n`,
      `${heading}\n${body}\n\nmore`,
    ]);
    expect(chunks.join("")).toBe(text);
  });

  it("splits at line breaks when no paragraph or heading boundary exists", () => {
    const firstLine = `${"a".repeat(15)}\n`;
    const secondLine = "b".repeat(15);
    const text = `${firstLine}${secondLine}`;

    const chunks = splitSlackResponse(text, 20);

    expect(chunks).toEqual([firstLine, secondLine]);
    expect(chunks.join("")).toBe(text);
  });

  it("caps every chunk when no natural split boundary exists", () => {
    const response = "x".repeat(24_001);

    const chunks = splitSlackResponse(response);

    expect(chunks.map((chunk) => chunk.length)).toEqual([
      12_000, 12_000, 1,
    ]);
    expect(chunks.join("")).toBe(response);
  });

  it("does not split an emoji UTF-16 surrogate pair across chunks", () => {
    const response = `${"x".repeat(11_999)}😀tail`;

    const chunks = splitSlackResponse(response);

    expect(chunks.map((chunk) => chunk.length)).toEqual([11_999, 6]);
    expect(chunks.join("")).toBe(response);
  });

  it("rejects maxLength values outside Slack's supported range", () => {
    expect(() => splitSlackResponse("abc", 1)).toThrow(RangeError);
    expect(() => splitSlackResponse("abc", 0)).toThrow(RangeError);
    expect(() => splitSlackResponse("abc", 2.5)).toThrow(RangeError);
    expect(() =>
      splitSlackResponse("abc", MAX_SLACK_MARKDOWN_LENGTH + 1),
    ).toThrow(RangeError);
  });
});

describe("Slack delivery boundary", () => {
  it("posts durable responses with the caller-supplied metadata event type", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const adapter = fakeSlackAdapter({ postMessage });
    const boundary = createSlackDeliveryBoundary(adapter, {
      responseMetadataEvent: "custom_agent_responded",
    });

    await boundary.deliver(
      fakeThread(adapter),
      "## Three projects\n\n- Project one",
      "delivery-1",
    );

    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1720000000.000100",
      markdown_text: "## Three projects\n\n- Project one",
      metadata: {
        event_type: "custom_agent_responded",
        event_payload: { delivery_id: "delivery-1" },
      },
    });
  });

  it("rejects invalid delivery boundary options", () => {
    const adapter = fakeSlackAdapter();
    expect(() =>
      createSlackDeliveryBoundary(adapter, {
        responseMetadataEvent: "   ",
      }),
    ).toThrow(/responseMetadataEvent/);
    expect(() =>
      createSlackDeliveryBoundary(adapter, {
        responseMetadataEvent: "custom_agent_responded",
        maxMarkdownLength: MAX_SLACK_MARKDOWN_LENGTH + 1,
      }),
    ).toThrow(RangeError);
  });

  it("splits oversized markdown at a paragraph boundary and marks the final message delivered", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const adapter = fakeSlackAdapter({ postMessage });
    const boundary = createSlackDeliveryBoundary(adapter, {
      responseMetadataEvent: "custom_agent_responded",
    });
    const firstSection = "a".repeat(11_900);
    const finalSection = `## Next section\n\n${"b".repeat(200)}`;

    await boundary.deliver(
      fakeThread(adapter),
      `${firstSection}\n\n${finalSection}`,
      "delivery-1",
    );

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      channel: "C123",
      thread_ts: "1720000000.000100",
      markdown_text: `${firstSection}\n\n`,
      metadata: {
        event_type: "custom_agent_responded",
        event_payload: { delivery_id: "delivery-1:chunk:0:2" },
      },
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      channel: "C123",
      thread_ts: "1720000000.000100",
      markdown_text: finalSection,
      metadata: {
        event_type: "custom_agent_responded",
        event_payload: { delivery_id: "delivery-1" },
      },
    });
  });

  it("honors a custom maxMarkdownLength option", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const adapter = fakeSlackAdapter({ postMessage });
    const boundary = createSlackDeliveryBoundary(adapter, {
      responseMetadataEvent: "custom_agent_responded",
      maxMarkdownLength: 10,
    });

    await boundary.deliver(
      fakeThread(adapter),
      "a".repeat(15),
      "delivery-1",
    );

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ markdown_text: "a".repeat(10) }),
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ markdown_text: "a".repeat(5) }),
    );
  });

  it("does not repost a completed prefix chunk during delivery recovery", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const replies = vi.fn().mockResolvedValue({
      messages: [
        {
          metadata: {
            event_type: "custom_agent_responded",
            event_payload: {
              delivery_id: "delivery-1:chunk:0:2",
            },
          },
        },
      ],
    });
    const adapter = fakeSlackAdapter({ postMessage, replies });
    const boundary = createSlackDeliveryBoundary(adapter, {
      responseMetadataEvent: "custom_agent_responded",
    });
    const firstSection = "a".repeat(11_900);
    const finalSection = `## Next section\n\n${"b".repeat(200)}`;

    await boundary.deliver(
      fakeThread(adapter),
      `${firstSection}\n\n${finalSection}`,
      "delivery-1",
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1720000000.000100",
      markdown_text: finalSection,
      metadata: {
        event_type: "custom_agent_responded",
        event_payload: { delivery_id: "delivery-1" },
      },
    });
  });

  it("skips all posts when a multi-chunk delivery is already marked delivered", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const replies = vi.fn().mockResolvedValue({
      messages: [
        {
          metadata: {
            event_type: "custom_agent_responded",
            event_payload: { delivery_id: "delivery-1" },
          },
        },
      ],
    });
    const adapter = fakeSlackAdapter({ postMessage, replies });
    const boundary = createSlackDeliveryBoundary(adapter, {
      responseMetadataEvent: "custom_agent_responded",
    });

    await boundary.deliver(
      fakeThread(adapter),
      "x".repeat(15_000),
      "delivery-1",
    );

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("reconciles accepted responses across paginated Slack replies", async () => {
    const replies = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            metadata: {
              event_type: "other_event",
              event_payload: { delivery_id: "delivery-1" },
            },
          },
        ],
        response_metadata: { next_cursor: "next" },
      })
      .mockResolvedValueOnce({
        messages: [
          {
            metadata: {
              event_type: "custom_agent_responded",
              event_payload: { delivery_id: "delivery-1" },
            },
          },
        ],
      });
    const adapter = fakeSlackAdapter({ replies });
    const boundary = createSlackDeliveryBoundary(adapter, {
      responseMetadataEvent: "custom_agent_responded",
    });

    await expect(
      boundary.getDeliveryStatus(fakeThread(adapter), "delivery-1"),
    ).resolves.toBe("delivered");

    expect(replies).toHaveBeenNthCalledWith(2, {
      channel: "C123",
      ts: "1720000000.000100",
      include_all_metadata: true,
      limit: 100,
      cursor: "next",
    });
  });

  it("returns not_delivered when replies do not carry the matching event type", async () => {
    const replies = vi.fn().mockResolvedValue({
      messages: [
        {
          metadata: {
            event_type: "atlas_explorer_responded",
            event_payload: { delivery_id: "delivery-1" },
          },
        },
      ],
    });
    const adapter = fakeSlackAdapter({ replies });
    const boundary = createSlackDeliveryBoundary(adapter, {
      responseMetadataEvent: "custom_agent_responded",
    });

    await expect(
      boundary.getDeliveryStatus(fakeThread(adapter), "delivery-1"),
    ).resolves.toBe("not_delivered");
  });

  it("returns unknown when Slack reply reconciliation fails", async () => {
    const replies = vi
      .fn()
      .mockRejectedValue(new Error("slack_rate_limited"));
    const adapter = fakeSlackAdapter({ replies });
    const boundary = createSlackDeliveryBoundary(adapter, {
      responseMetadataEvent: "custom_agent_responded",
    });

    await expect(
      boundary.getDeliveryStatus(fakeThread(adapter), "delivery-1"),
    ).resolves.toBe("unknown");
  });
});

function fakeSlackAdapter(
  overrides: {
    postMessage?: ReturnType<typeof vi.fn>;
    replies?: ReturnType<typeof vi.fn>;
  } = {},
): SlackAdapter {
  return {
    name: "slack",
    decodeThreadId: () => ({
      channel: "C123",
      threadTs: "1720000000.000100",
    }),
    webClient: {
      chat: {
        postMessage:
          overrides.postMessage ??
          vi.fn().mockResolvedValue({ ts: "2" }),
      },
      conversations: {
        replies:
          overrides.replies ??
          vi.fn().mockResolvedValue({ messages: [] }),
      },
    },
  } as unknown as SlackAdapter;
}

function fakeThread(adapter: SlackAdapter): Thread {
  return {
    adapter,
    id: "slack:C123:1720000000.000100",
  } as unknown as Thread;
}
