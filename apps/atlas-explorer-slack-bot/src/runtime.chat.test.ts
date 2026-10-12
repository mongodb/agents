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

import {
  createMockAdapter,
  createMockState,
  createTestMessage,
} from "@chat-adapter/tests";
import type { SlackAdapter } from "@chat-adapter/slack";
import type { Author } from "chat";
import { describe, expect, it, vi } from "vitest";

import { REVIEW_APPROVE_ACTION_ID } from "@repo/agent-engine-chat/chat";
import { MemoryThreadStore } from "@repo/agent-engine-chat/store";
import {
  FakeAgentGateway,
  completed,
  seedPendingReview,
  slackAdaClientUser,
} from "@repo/agent-engine-chat/testing";
import type { SlackBotConfig } from "./loadConfig.js";
import { createRuntime } from "./runtime.js";

const BOT_NAME = "TestBot";

describe("Chat SDK runtime", () => {
  it("composes one Chat instance with shared handlers and injected adapters", async () => {
    const adapter = createMockAdapter("slack", {
      botUserId: "B123",
      isDM: () => true,
    }) as SlackAdapter;
    const agent = new FakeAgentGateway();
    agent.invokeResult = completed;
    const runtime = await createRuntime(config(), {
      agent,
      slackAdapter: adapter,
      state: createMockState(),
      store: new MemoryThreadStore(),
    });
    await runtime.bot.initialize();

    await runtime.bot.processMessage(
      adapter,
      "slack:D123:1720000000.000100",
      createTestMessage("event-1", "List projects", {
        threadId: "slack:D123:1720000000.000100",
        author: author(),
      }),
    );

    expect(agent.invokeInputs).toEqual([
      {
        actorId: "slack:U123",
        message: "List projects",
        ...slackAdaClientUser,
      },
    ]);
    expect(adapter.initialize).toHaveBeenCalledTimes(1);
    await runtime.bot.shutdown();
    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
  });

  it("enforces the platform-qualified actor allowlist", async () => {
    const adapter = createMockAdapter("slack", {
      botUserId: "B123",
      isDM: () => true,
    }) as SlackAdapter;
    const agent = new FakeAgentGateway();
    agent.invokeResult = completed;
    const restrictedConfig = config();
    restrictedConfig.chat.allowedActorIds = ["slack:U999"];
    const runtime = await createRuntime(restrictedConfig, {
      agent,
      slackAdapter: adapter,
      state: createMockState(),
      store: new MemoryThreadStore(),
    });
    await runtime.bot.initialize();

    await runtime.bot.processMessage(
      adapter,
      "slack:D123:1720000000.000100",
      createTestMessage("event-1", "List projects", {
        threadId: "slack:D123:1720000000.000100",
        author: author(),
      }),
    );

    expect(agent.invokeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      "slack:D123:1720000000.000100",
      `You are not authorized to use this ${BOT_NAME} bot.`,
    );
    await runtime.bot.shutdown();
  });

  it("enforces the actor allowlist on review actions", async () => {
    const adapter = createMockAdapter("slack", {
      botUserId: "B123",
      isDM: () => true,
    }) as SlackAdapter;
    const agent = new FakeAgentGateway();
    agent.resumeResult = completed;
    const restrictedConfig = config();
    restrictedConfig.chat.allowedActorIds = ["slack:U123"];
    const store = new MemoryThreadStore();
    await seedPendingReview(store);
    const runtime = await createRuntime(restrictedConfig, {
      agent,
      slackAdapter: adapter,
      state: createMockState(),
      store,
    });
    await runtime.bot.initialize();

    await runtime.bot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter,
        messageId: "review-message",
        raw: {},
        threadId: "slack:C123:1720000000.000100",
        user: { ...author(), userId: "U999" },
        value: "interrupt-1",
      },
      undefined,
    );

    expect(agent.resumeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      "slack:C123:1720000000.000100",
      expect.stringMatching(/not authorized/i),
    );
    await runtime.bot.shutdown();
  });

  it("refuses a new conversation once the configured session limit is reached", async () => {
    const adapter = createMockAdapter("slack", {
      botUserId: "B123",
      isDM: () => true,
    }) as SlackAdapter;
    const agent = new FakeAgentGateway();
    agent.invokeResult = completed;
    const limitedConfig = config();
    limitedConfig.sessionLimit.limitPerHour = 1;
    const runtime = await createRuntime(limitedConfig, {
      agent,
      slackAdapter: adapter,
      state: createMockState(),
      store: new MemoryThreadStore(),
    });
    await runtime.bot.initialize();
    const firstThread = "slack:D123:1720000000.000100";
    const secondThread = "slack:D123:1720000000.000200";

    await runtime.bot.processMessage(
      adapter,
      firstThread,
      createTestMessage("event-1", "List projects", {
        threadId: firstThread,
        author: author(),
      }),
    );
    await runtime.bot.processMessage(
      adapter,
      secondThread,
      createTestMessage("event-2", "List clusters", {
        threadId: secondThread,
        author: author(),
      }),
    );

    expect(agent.invokeInputs).toHaveLength(1);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      secondThread,
      expect.stringContaining(
        `${BOT_NAME} has reached its hourly limit for starting or resuming conversations.`,
      ),
    );

    await runtime.bot.shutdown();
  });

  it("routes handler failures through the runtime logger", async () => {
    const adapter = createMockAdapter("slack", {
      botUserId: "B123",
      isDM: () => true,
    }) as SlackAdapter;
    const agent = new FakeAgentGateway();
    const failure = new Error("gateway unavailable");
    agent.invokeError = failure;
    const logger = { error: vi.fn() };
    const runtime = await createRuntime(config(), {
      agent,
      logger,
      slackAdapter: adapter,
      state: createMockState(),
      store: new MemoryThreadStore(),
    });
    await runtime.bot.initialize();

    await runtime.bot.processMessage(
      adapter,
      "slack:D123:1720000000.000100",
      createTestMessage("event-1", "List projects", {
        threadId: "slack:D123:1720000000.000100",
        author: author(),
      }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      `${BOT_NAME} invocation failed`,
      failure,
    );
    await runtime.bot.shutdown();
  });
});

function config(): SlackBotConfig {
  return {
    mode: "socket",
    chat: {
      allowedActorIds: ["slack:U123"],
    },
    slack: {
      appToken: "xapp-test",
      botDisplayName: BOT_NAME,
      botToken: "xoxb-test",
    },
    agentEngine: {
      baseUrl: "http://localhost:3000",
      invokeTarget: "local",
    },
    sessionLimit: {
      idleTtlSeconds: 600,
      limitPerHour: 30,
    },
    store: {
      databaseName: "atlas_explorer_test",
    },
  };
}

function author(): Author {
  return {
    userId: "U123",
    userName: "ada",
    fullName: "Ada Lovelace",
    isBot: false,
    isMe: false,
  };
}
