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

import { readFile } from "node:fs/promises";

import type { SlackAdapter } from "@chat-adapter/slack";
import type { AppHomeOpenedEvent, Chat, Thread } from "chat";
import { describe, expect, it, vi } from "vitest";

import {
  buildSlackHomeView,
  createSlackDeliveryBoundary,
  registerSlackPlatformHandlers,
  RESPONSE_METADATA_EVENT,
} from "./slack.js";

describe("Atlas Explorer Slack configuration", () => {
  it("keeps the response metadata event type aligned with manifest.json", async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL("../../manifest.json", import.meta.url),
        "utf8",
      ),
    ) as {
      metadata?: {
        event_subscriptions?: Array<{ event_type?: string }>;
      };
    };

    expect(
      manifest.metadata?.event_subscriptions?.map(
        (event) => event.event_type,
      ),
    ).toContain(RESPONSE_METADATA_EVENT);
  });

  it("wires the Atlas Explorer response metadata event into delivery", async () => {
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
        event_type: RESPONSE_METADATA_EVENT,
        event_payload: { delivery_id: "delivery-1" },
      },
    });
  });

  it("publishes the Atlas Explorer App Home view on the home tab", async () => {
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
      tab: "home",
      userId: "U123",
    });

    expect(publishHomeView).toHaveBeenCalledTimes(1);
    expect(publishHomeView).toHaveBeenCalledWith(
      "U123",
      buildSlackHomeView("AtlasExplorer"),
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
