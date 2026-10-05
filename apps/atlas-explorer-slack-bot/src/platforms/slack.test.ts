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
import type {
  AppHomeOpenedEvent,
  Chat,
  Thread,
} from "chat";
import { describe, expect, it, vi } from "vitest";

import {
  createSlackDeliveryBoundary,
  parseSlackReviewInterruptId,
  registerSlackPlatformHandlers,
} from "./slack.js";

describe("Slack platform boundary", () => {
  it("posts durable responses as native Slack markdown with delivery metadata", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const adapter = fakeSlackAdapter({ postMessage });
    const boundary = createSlackDeliveryBoundary(adapter);

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
        event_type: "atlas_explorer_responded",
        event_payload: { delivery_id: "delivery-1" },
      },
    });
  });

  it("splits oversized markdown at a paragraph boundary and marks the final message delivered", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const adapter = fakeSlackAdapter({ postMessage });
    const boundary = createSlackDeliveryBoundary(adapter);
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
        event_type: "atlas_explorer_responded",
        event_payload: { delivery_id: "delivery-1:chunk:0:2" },
      },
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      channel: "C123",
      thread_ts: "1720000000.000100",
      markdown_text: finalSection,
      metadata: {
        event_type: "atlas_explorer_responded",
        event_payload: { delivery_id: "delivery-1" },
      },
    });
  });

  it("does not repost a completed prefix chunk during delivery recovery", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const replies = vi.fn().mockResolvedValue({
      messages: [
        {
          metadata: {
            event_type: "atlas_explorer_responded",
            event_payload: {
              delivery_id: "delivery-1:chunk:0:2",
            },
          },
        },
      ],
    });
    const adapter = fakeSlackAdapter({ postMessage, replies });
    const boundary = createSlackDeliveryBoundary(adapter);
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
        event_type: "atlas_explorer_responded",
        event_payload: { delivery_id: "delivery-1" },
      },
    });
  });

  it("caps every markdown payload when no natural split boundary exists", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const adapter = fakeSlackAdapter({ postMessage });
    const boundary = createSlackDeliveryBoundary(adapter);
    const response = "x".repeat(24_001);

    await boundary.deliver(
      fakeThread(adapter),
      response,
      "delivery-1",
    );

    const payloads = postMessage.mock.calls.map(
      ([payload]) =>
        (payload as { markdown_text: string }).markdown_text,
    );
    expect(payloads.map((payload) => payload.length)).toEqual([
      12_000, 12_000, 1,
    ]);
    expect(payloads.join("")).toBe(response);
  });

  it("does not split an emoji's UTF-16 surrogate pair across messages", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
    const adapter = fakeSlackAdapter({ postMessage });
    const boundary = createSlackDeliveryBoundary(adapter);
    const response = `${"x".repeat(11_999)}😀tail`;

    await boundary.deliver(
      fakeThread(adapter),
      response,
      "delivery-1",
    );

    const payloads = postMessage.mock.calls.map(
      ([payload]) =>
        (payload as { markdown_text: string }).markdown_text,
    );
    expect(payloads.map((payload) => payload.length)).toEqual([
      11_999, 6,
    ]);
    expect(payloads.join("")).toBe(response);
  });

  it("reconciles accepted responses across paginated Slack replies", async () => {
    const replies = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [],
        response_metadata: { next_cursor: "next" },
      })
      .mockResolvedValueOnce({
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
    const boundary = createSlackDeliveryBoundary(adapter);

    await expect(
      boundary.getDeliveryStatus(
        fakeThread(adapter),
        "delivery-1",
      ),
    ).resolves.toBe("delivered");

    expect(replies).toHaveBeenNthCalledWith(2, {
      channel: "C123",
      ts: "1720000000.000100",
      include_all_metadata: true,
      limit: 100,
      cursor: "next",
    });
  });

  it("accepts legacy review values only when signed thread context matches", () => {
    const value = JSON.stringify({
      channelId: "C123",
      threadTs: "1720000000.000100",
      interruptId: "interrupt-1",
    });

    expect(
      parseSlackReviewInterruptId(
        value,
        "slack:C123:1720000000.000100",
      ),
    ).toBe("interrupt-1");
    expect(
      parseSlackReviewInterruptId(
        value,
        "slack:C999:1720000000.000100",
      ),
    ).toBeNull();
    expect(
      parseSlackReviewInterruptId(
        "interrupt-2",
        "slack:C123:1720000000.000100",
      ),
    ).toBe("interrupt-2");
  });

  it("publishes Slack App Home only for the home tab", async () => {
    let handler:
      | ((event: AppHomeOpenedEvent) => Promise<void> | void)
      | undefined;
    const chat = {
      onAppHomeOpened(
        registered: (
          event: AppHomeOpenedEvent,
        ) => Promise<void> | void,
      ) {
        handler = registered;
      },
    } as unknown as Chat;
    const publishHomeView = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      ...fakeSlackAdapter(),
      publishHomeView,
    } as unknown as SlackAdapter;
    registerSlackPlatformHandlers(chat, adapter, "AtlasExplorer");

    await handler?.({
      adapter,
      channelId: "D123",
      tab: "messages",
      userId: "U123",
    });
    await handler?.({
      adapter,
      channelId: "D123",
      tab: "home",
      userId: "U123",
    });

    expect(publishHomeView).toHaveBeenCalledTimes(1);
    expect(publishHomeView).toHaveBeenCalledWith(
      "U123",
      expect.objectContaining({ type: "home" }),
    );
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
