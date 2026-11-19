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
import {
  createMockAdapter,
  createMockState,
  createTestMessage,
} from "@chat-adapter/tests";
import { Chat, type AppHomeOpenedEvent, type Author } from "chat";
import { describe, expect, it, vi } from "vitest";

import { REVIEW_APPROVE_ACTION_ID } from "../chat/cards.js";
import {
  completed,
  FakeAgentGateway,
  seedPendingReview,
  slackAdaClientUser,
} from "../chat/handlers.test-helpers.js";
import { MemoryThreadStore } from "../store/memoryThreadStore.js";
import { MAX_SLACK_MARKDOWN_LENGTH } from "./delivery.js";
import { registerSlackChatHandlers } from "./handlers.js";

const BOT_NAME = "TestBot";
const RESPONSE_METADATA_EVENT = "test_agent_responded";
const CHANNEL_THREAD_ID = "slack:C123:1720000000.000100";
const DM_THREAD_ID = "slack:D123:1720000000.000100";
const OTHER_THREAD_ID = "other:C123:thread-1";

describe("registerSlackChatHandlers", () => {
  it("wires Slack durable markdown delivery with responseMetadataEvent and maxMarkdownLength", async () => {
    const { adapter, postMessage } = createFakeSlackAdapter();
    const { bot, agent, logger } = createBot({ slack: adapter });
    agent.invokeResult = {
      ...completed,
      response: "a".repeat(15),
    };

    registerSlackChatHandlers(bot, {
      adapter,
      agent,
      botName: BOT_NAME,
      logger,
      maxMarkdownLength: 10,
      responseMetadataEvent: RESPONSE_METADATA_EVENT,
      store: new MemoryThreadStore(),
    });
    await bot.initialize();

    await bot.processMessage(
      adapter,
      DM_THREAD_ID,
      createTestMessage("event-1", "List projects", {
        threadId: DM_THREAD_ID,
        author: author(),
      }),
    );

    expect(logger.error).not.toHaveBeenCalled();
    expect(adapter.postMessage).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      channel: "D123",
      thread_ts: "1720000000.000100",
      markdown_text: "a".repeat(10),
      metadata: {
        event_type: RESPONSE_METADATA_EVENT,
        event_payload: { delivery_id: "slack:event-1:chunk:0:2" },
      },
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      channel: "D123",
      thread_ts: "1720000000.000100",
      markdown_text: "a".repeat(5),
      metadata: {
        event_type: RESPONSE_METADATA_EVENT,
        event_payload: { delivery_id: "slack:event-1" },
      },
    });
  });

  it("scopes Slack delivery and review parsing strictly to the matching adapter name", async () => {
    const { adapter: slackAdapter, postMessage } = createFakeSlackAdapter();
    const otherAdapter = createMockAdapter("other", {
      botUserId: "OB123",
      isDM: () => true,
    });
    const store = new MemoryThreadStore();
    const { bot, agent, logger } = createBot({
      slack: slackAdapter,
      other: otherAdapter,
    });

    registerSlackChatHandlers(bot, {
      adapter: slackAdapter,
      agent,
      botName: BOT_NAME,
      logger,
      responseMetadataEvent: RESPONSE_METADATA_EVENT,
      store,
    });
    await bot.initialize();

    await bot.processMessage(
      otherAdapter,
      OTHER_THREAD_ID,
      createTestMessage("event-other", "List projects", {
        threadId: OTHER_THREAD_ID,
        author: author(),
      }),
    );

    expect(postMessage).not.toHaveBeenCalled();
    expect(otherAdapter.postMessage).toHaveBeenCalledWith(OTHER_THREAD_ID, {
      markdown: completed.response,
    });

    const rawJsonValue = JSON.stringify({ opaque: "non-slack-id" });
    await store.put({
      threadId: OTHER_THREAD_ID,
      agentSessionId: "session-1",
      pendingExecutionId: "execution-2",
      pendingInterruptId: rawJsonValue,
      pendingResumeSchema: { type: "object" },
      pendingActionRequests: [
        { name: "mongodb__insert_many", args: { count: 1 } },
      ],
      pendingRequestedByActorId: "other:U123",
      updatedAt: new Date(),
    });

    await bot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter: otherAdapter,
        messageId: "review-message",
        raw: {},
        threadId: OTHER_THREAD_ID,
        user: author(),
        value: rawJsonValue,
      },
      undefined,
    );

    expect(agent.resumeInputs).toHaveLength(1);
    expect(agent.resumeInputs[0]?.interruptId).toBe(rawJsonValue);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("parses legacy Slack JSON review interrupt IDs and rejects mismatched thread context", async () => {
    const { adapter } = createFakeSlackAdapter();
    const store = new MemoryThreadStore();
    const { bot, agent, logger } = createBot({ slack: adapter });

    registerSlackChatHandlers(bot, {
      adapter,
      agent,
      botName: BOT_NAME,
      logger,
      responseMetadataEvent: RESPONSE_METADATA_EVENT,
      store,
    });
    await bot.initialize();
    await seedPendingReview(store);

    await bot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter,
        messageId: "review-message-mismatch",
        raw: {},
        threadId: CHANNEL_THREAD_ID,
        user: author(),
        value: JSON.stringify({
          channelId: "C999",
          threadTs: "1720000000.000100",
          interruptId: "interrupt-1",
        }),
      },
      undefined,
    );

    expect(agent.resumeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      CHANNEL_THREAD_ID,
      expect.stringMatching(/invalid or expired/i),
    );

    await bot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter,
        messageId: "review-message-valid",
        raw: {},
        threadId: CHANNEL_THREAD_ID,
        user: author(),
        value: JSON.stringify({
          channelId: "C123",
          threadTs: "1720000000.000100",
          interruptId: "interrupt-1",
        }),
      },
      undefined,
    );

    expect(agent.resumeInputs).toEqual([
      expect.objectContaining({
        actorId: "slack:U123",
        interruptId: "interrupt-1",
        ...slackAdaClientUser,
      }),
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("registers the App Home handler only when buildHomeView is provided", async () => {
    const { adapter, publishHomeView } = createFakeSlackAdapter();
    const { bot: withoutHomeBot, agent } = createBot({ slack: adapter });
    const onAppHomeOpenedSpy = vi.spyOn(withoutHomeBot, "onAppHomeOpened");

    registerSlackChatHandlers(withoutHomeBot, {
      adapter,
      agent,
      botName: BOT_NAME,
      responseMetadataEvent: RESPONSE_METADATA_EVENT,
      store: new MemoryThreadStore(),
    });

    expect(onAppHomeOpenedSpy).not.toHaveBeenCalled();

    const { bot: withHomeBot } = createBot({ slack: adapter });
    const buildHomeView = vi.fn(async (event: AppHomeOpenedEvent) => ({
      type: "home" as const,
      blocks: [
        {
          type: "header" as const,
          text: {
            type: "plain_text" as const,
            text: `Welcome ${event.userId}`,
          },
        },
      ],
    }));

    registerSlackChatHandlers(withHomeBot, {
      adapter,
      agent,
      botName: BOT_NAME,
      buildHomeView,
      responseMetadataEvent: RESPONSE_METADATA_EVENT,
      store: new MemoryThreadStore(),
    });
    await withHomeBot.initialize();

    const tasks: Promise<unknown>[] = [];
    withHomeBot.processAppHomeOpened(
      {
        adapter,
        channelId: "D123",
        tab: "home",
        userId: "U123",
      },
      { waitUntil: (task) => tasks.push(task) },
    );
    await Promise.all(tasks);

    expect(buildHomeView).toHaveBeenCalledTimes(1);
    expect(publishHomeView).toHaveBeenCalledWith("U123", {
      type: "home",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Welcome U123" },
        },
      ],
    });
  });

  it("forwards chat handler options including allowlist, messages, logger, and sessionLimit", async () => {
    const { adapter } = createFakeSlackAdapter();
    const { bot, agent, logger } = createBot({ slack: adapter });
    const failure = new Error("gateway unavailable");

    registerSlackChatHandlers(bot, {
      adapter,
      agent,
      authorizedActorIds: new Set(["slack:U123"]),
      botName: BOT_NAME,
      logger,
      messages: { emptyPrompt: "Custom empty prompt" },
      responseMetadataEvent: RESPONSE_METADATA_EVENT,
      sessionLimit: { limit: 1, idleTtlMs: 600_000 },
      store: new MemoryThreadStore(),
    });
    await bot.initialize();

    await bot.processMessage(
      adapter,
      DM_THREAD_ID,
      createTestMessage("event-unauthorized", "List projects", {
        threadId: DM_THREAD_ID,
        author: { ...author(), userId: "U999" },
      }),
    );
    expect(adapter.postMessage).toHaveBeenCalledWith(
      DM_THREAD_ID,
      `You are not authorized to use this ${BOT_NAME} bot.`,
    );

    await bot.processMessage(
      adapter,
      DM_THREAD_ID,
      createTestMessage("event-empty", "   ", {
        threadId: DM_THREAD_ID,
        author: author(),
      }),
    );
    expect(adapter.postMessage).toHaveBeenCalledWith(
      DM_THREAD_ID,
      "Custom empty prompt",
    );

    agent.invokeError = failure;
    await bot.processMessage(
      adapter,
      DM_THREAD_ID,
      createTestMessage("event-fail", "Trigger error", {
        threadId: DM_THREAD_ID,
        author: author(),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      `${BOT_NAME} invocation failed`,
      failure,
    );

    agent.invokeError = undefined;
    const secondThread = "slack:D123:1720000000.000200";
    await bot.processMessage(
      adapter,
      DM_THREAD_ID,
      createTestMessage("event-ok", "First session", {
        threadId: DM_THREAD_ID,
        author: author(),
      }),
    );
    await bot.processMessage(
      adapter,
      secondThread,
      createTestMessage("event-limited", "Second session", {
        threadId: secondThread,
        author: author(),
      }),
    );
    expect(adapter.postMessage).toHaveBeenCalledWith(
      secondThread,
      expect.stringContaining(`${BOT_NAME} has reached its hourly limit`),
    );
  });

  it("propagates validation errors before registering App Home", () => {
    const { adapter } = createFakeSlackAdapter();
    const { bot, agent } = createBot({ slack: adapter });
    const onAppHomeOpenedSpy = vi.spyOn(bot, "onAppHomeOpened");
    const buildHomeView = vi.fn(() => ({ type: "home" as const, blocks: [] }));

    expect(() =>
      registerSlackChatHandlers(bot, {
        adapter,
        agent,
        botName: BOT_NAME,
        buildHomeView,
        responseMetadataEvent: "   ",
        store: new MemoryThreadStore(),
      }),
    ).toThrow(/responseMetadataEvent/);

    expect(() =>
      registerSlackChatHandlers(bot, {
        adapter,
        agent,
        botName: BOT_NAME,
        buildHomeView,
        maxMarkdownLength: MAX_SLACK_MARKDOWN_LENGTH + 1,
        responseMetadataEvent: RESPONSE_METADATA_EVENT,
        store: new MemoryThreadStore(),
      }),
    ).toThrow(RangeError);

    expect(() =>
      registerSlackChatHandlers(bot, {
        adapter,
        agent,
        botName: BOT_NAME,
        buildHomeView,
        responseMetadataEvent: RESPONSE_METADATA_EVENT,
        sessionLimit: { limit: 0, idleTtlMs: 600_000 },
        store: new MemoryThreadStore(),
      }),
    ).toThrow(/sessionLimit\.limit/);

    expect(onAppHomeOpenedSpy).not.toHaveBeenCalled();
  });
});

function createFakeSlackAdapter() {
  const postMessage = vi.fn().mockResolvedValue({ ts: "2" });
  const replies = vi.fn().mockResolvedValue({ messages: [] });
  const publishHomeView = vi.fn().mockResolvedValue(undefined);
  const mock = createMockAdapter("slack", {
    botUserId: "B123",
    isDM: (threadId) => threadId.startsWith("slack:D"),
  });
  const adapter = Object.assign(mock, {
    decodeThreadId(threadId: string) {
      const [, channel = "", threadTs = ""] = threadId.split(":");
      return { channel, threadTs };
    },
    publishHomeView,
    webClient: {
      chat: { postMessage },
      conversations: { replies },
    },
  }) as unknown as SlackAdapter;
  return { adapter, postMessage, publishHomeView, replies };
}

function createBot(adapters: Record<string, ReturnType<typeof createMockAdapter> | SlackAdapter>) {
  const state = createMockState();
  const bot = new Chat({
    adapters,
    concurrency: "concurrent",
    logger: "silent",
    state,
    userName: BOT_NAME,
  });
  const agent = new FakeAgentGateway();
  agent.invokeResult = completed;
  agent.resumeResult = completed;
  const logger = { error: vi.fn(), warn: vi.fn() };
  return { bot, agent, logger, state };
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
