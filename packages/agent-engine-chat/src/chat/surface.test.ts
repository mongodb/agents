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

import type { Adapter, Thread } from "chat";
import { describe, expect, it, vi } from "vitest";

import { createConversationSurface } from "./surface.js";

const BOT_NAME = "TestBot";

describe("createConversationSurface", () => {
  it("uses normalized thread operations for posts, delivery, and status", async () => {
    const thread = fakeThread();
    const surface = createConversationSurface(thread, {
      botName: BOT_NAME,
    });

    await surface.post("Hello");
    await surface.deliver("**Done**", "delivery-1");
    await surface.setStatus("Working");

    expect(thread.post).toHaveBeenNthCalledWith(1, "Hello");
    expect(thread.post).toHaveBeenNthCalledWith(2, {
      markdown: "**Done**",
    });
    expect(thread.startTyping).toHaveBeenCalledWith("Working");
    await expect(
      surface.getDeliveryStatus("delivery-1"),
    ).resolves.toBe("unknown");
  });

  it("delegates durable delivery capabilities to a platform boundary", async () => {
    const thread = fakeThread();
    const deliver = vi.fn().mockResolvedValue(undefined);
    const getDeliveryStatus = vi
      .fn()
      .mockResolvedValue("delivered");
    const surface = createConversationSurface(thread, {
      botName: BOT_NAME,
      delivery: { deliver, getDeliveryStatus },
    });

    await surface.deliver("Done", "delivery-1");

    expect(deliver).toHaveBeenCalledWith(
      thread,
      "Done",
      "delivery-1",
    );
    await expect(
      surface.getDeliveryStatus("delivery-1"),
    ).resolves.toBe("delivered");
  });

  it("edits the originating review message through the generic adapter", async () => {
    const thread = fakeThread();
    const surface = createConversationSurface(thread, {
      botName: BOT_NAME,
      reviewMessageId: "message-1",
    });

    await surface.updateReviewStatus?.("approved");

    expect(thread.adapter.editMessage).toHaveBeenCalledWith(
      thread.id,
      "message-1",
      `Approved by the requester. ${BOT_NAME} is continuing.`,
    );
  });
});

function fakeThread(): Thread {
  const adapter = {
    editMessage: vi.fn().mockResolvedValue({
      id: "message-1",
      threadId: "slack:C123:1",
      raw: {},
    }),
  } as unknown as Adapter;
  return {
    adapter,
    id: "slack:C123:1",
    post: vi.fn().mockResolvedValue(undefined),
    startTyping: vi.fn().mockResolvedValue(undefined),
  } as unknown as Thread;
}
