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

import * as slackAdapterModule from "@chat-adapter/slack";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSlackPlatformAdapter } from "./adapter.js";

vi.mock("@chat-adapter/slack", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@chat-adapter/slack")>();
  return {
    ...actual,
    createSlackAdapter: vi.fn(actual.createSlackAdapter),
  };
});

describe("Slack platform adapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("applies safe defaults and forwards mode, tokens, and suggested prompts", () => {
    const suggestedPrompts = {
      title: "Explore data",
      prompts: [
        {
          title: "List items",
          message: "List all items I can access.",
        },
      ],
    };

    createSlackPlatformAdapter({
      apiUrl: "https://slack.example/api/",
      appToken: "xapp-test",
      botToken: "xoxb-test",
      displayName: "DemoBot",
      mode: "socket",
      signingSecret: "signing-secret",
      suggestedPrompts,
    });

    expect(slackAdapterModule.createSlackAdapter).toHaveBeenCalledWith({
      agentView: true,
      apiUrl: "https://slack.example/api/",
      appToken: "xapp-test",
      botToken: "xoxb-test",
      mode: "socket",
      sessionTitle: true,
      signingSecret: "signing-secret",
      suggestedPrompts: {
        title: "Explore data",
        prompts: [
          {
            title: "List items",
            message: "List all items I can access.",
          },
        ],
      },
      userName: "DemoBot",
      webClientOptions: {
        timeout: 30_000,
        retryConfig: { retries: 0 },
        rejectRateLimitedCalls: true,
      },
    });
  });

  it("omits optional settings when unset and merges webClientOptions overrides", () => {
    createSlackPlatformAdapter({
      botToken: "xoxb-test",
      displayName: "DemoBot",
      mode: "webhook",
      signingSecret: "signing-secret",
      webClientOptions: {
        timeout: 15_000,
      },
    });

    expect(slackAdapterModule.createSlackAdapter).toHaveBeenCalledWith({
      agentView: true,
      botToken: "xoxb-test",
      mode: "webhook",
      sessionTitle: true,
      signingSecret: "signing-secret",
      userName: "DemoBot",
      webClientOptions: {
        timeout: 15_000,
        retryConfig: { retries: 0 },
        rejectRateLimitedCalls: true,
      },
    });
  });
});
