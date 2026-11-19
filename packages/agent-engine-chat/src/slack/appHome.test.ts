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
import { describe, expect, it, vi } from "vitest";

import { registerSlackAppHomeHandler } from "./appHome.js";

describe("registerSlackAppHomeHandler", () => {
  it("publishes App Home only for the matching adapter and non-messages tabs", async () => {
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
      name: "slack",
      publishHomeView,
    } as unknown as SlackAdapter;
    const otherAdapter = { name: "slack" } as unknown as SlackAdapter;
    const buildHomeView = vi.fn((event: AppHomeOpenedEvent) => ({
      type: "home",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `Hello ${event.userId}` },
        },
      ],
    }));

    registerSlackAppHomeHandler(chat, adapter, buildHomeView);

    await handler?.({
      adapter: otherAdapter,
      channelId: "D123",
      tab: "home",
      userId: "U123",
    });
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

    expect(buildHomeView).toHaveBeenCalledTimes(1);
    expect(publishHomeView).toHaveBeenCalledTimes(1);
    expect(publishHomeView).toHaveBeenCalledWith("U123", {
      type: "home",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Hello U123" },
        },
      ],
    });
  });
});
