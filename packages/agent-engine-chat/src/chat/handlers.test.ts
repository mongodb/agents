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
import { Chat, type Adapter, type Author } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryThreadStore } from "../store/memoryThreadStore.js";
import type { ThreadStore } from "../store/threadStore.js";
import {
  REVIEW_APPROVE_ACTION_ID,
  REVIEW_REJECT_ACTION_ID,
} from "./cards.js";
import {
  completed,
  FakeAgentGateway,
  seedPendingReview,
  slackAdaClientUser,
} from "./handlers.test-helpers.js";
import { registerChatHandlers } from "./handlers.js";

const BOT_NAME = "TestBot";
const CHANNEL_THREAD_ID = "slack:C123:1720000000.000100";
const DM_THREAD_ID = "slack:D123:1720000000.000100";

describe("registerChatHandlers", () => {
  let adapter: Adapter;
  let state: ReturnType<typeof createMockState>;
  let bot: Chat;
  let agent: FakeAgentGateway;
  let store: ThreadStore;

  beforeEach(async () => {
    state = createMockState();
    adapter = createMockAdapter("slack", {
      botUserId: "B123",
      isDM: (threadId) => threadId.startsWith("slack:D"),
    });
    bot = new Chat({
      adapters: { slack: adapter },
      concurrency: "concurrent",
      logger: "silent",
      state,
      userName: BOT_NAME,
    });
    agent = new FakeAgentGateway();
    agent.invokeResult = completed;
    agent.resumeResult = completed;
    store = new MemoryThreadStore();
    registerChatHandlers(bot, {
      agent,
      botName: BOT_NAME,
      reviewInterruptIdForAdapter: (
        _adapter,
        value,
        _threadId,
      ) => (value === "legacy-review-value" ? "interrupt-1" : value),
      store,
    });
    await bot.initialize();
  });

  it("refuses to register with a session limit it can't enforce", () => {
    expect(() =>
      registerChatHandlers(bot, {
        agent,
        botName: BOT_NAME,
        sessionLimit: { limit: 0, idleTtlMs: 600_000 },
        store,
      }),
    ).toThrow("sessionLimit.limit must be a positive integer, got 0");
  });

  it("subscribes on a mention and routes normalized identity", async () => {
    const message = testMessage(
      "message-1",
      CHANNEL_THREAD_ID,
      "List projects",
      { isMention: true },
    );

    await bot.processMessage(adapter, CHANNEL_THREAD_ID, message);

    expect(await state.isSubscribed(CHANNEL_THREAD_ID)).toBe(true);
    expect(agent.invokeInputs).toEqual([
      {
        actorId: "slack:U123",
        message: "List projects",
        ...slackAdaClientUser,
      },
    ]);
  });

  it("ignores a Slack name match without this bot's structured mention", async () => {
    const message = testMessage(
      "message-other-bot",
      CHANNEL_THREAD_ID,
      "@AtlasExplorer Local can you hear me?",
      {
        isMention: true,
        raw: {
          type: "message",
          text: "<@B999|AtlasExplorer Local> can you hear me?",
        },
      },
    );

    await bot.processMessage(adapter, CHANNEL_THREAD_ID, message);

    expect(await state.isSubscribed(CHANNEL_THREAD_ID)).toBe(false);
    expect(agent.invokeInputs).toEqual([]);
  });

  it("routes DMs without requiring a mention", async () => {
    await bot.processMessage(
      adapter,
      DM_THREAD_ID,
      testMessage("message-1", DM_THREAD_ID, "List projects"),
    );

    expect(agent.invokeInputs).toHaveLength(1);
    expect(agent.invokeInputs[0]?.actorId).toBe("slack:U123");
  });

  it("routes follow-ups only through Chat SDK subscriptions", async () => {
    await state.subscribe(CHANNEL_THREAD_ID);

    await bot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage("message-1", CHANNEL_THREAD_ID, "Follow up"),
    );

    expect(agent.invokeInputs[0]?.message).toBe("Follow up");
  });

  it("ignores a subscribed message addressed to another person", async () => {
    await state.subscribe(CHANNEL_THREAD_ID);

    await bot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-other",
        CHANNEL_THREAD_ID,
        "<@U999> can you take this?",
        {
          raw: {
            type: "message",
            text: "<@U999> can you take this?",
          },
        },
      ),
    );

    expect(await state.isSubscribed(CHANNEL_THREAD_ID)).toBe(true);
    expect(agent.invokeInputs).toEqual([]);
    expect(adapter.postMessage).not.toHaveBeenCalled();
  });

  it("routes a subscribed message that also mentions the bot", async () => {
    await state.subscribe(CHANNEL_THREAD_ID);

    await bot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-bot",
        CHANNEL_THREAD_ID,
        "<@B123> and <@U999> please look",
        {
          raw: {
            type: "message",
            text: "<@B123> and <@U999> please look",
          },
        },
      ),
    );

    expect(agent.invokeInputs).toEqual([
      {
        actorId: "slack:U123",
        message: "<@B123> and <@U999> please look",
        ...slackAdaClientUser,
      },
    ]);
  });

  it("routes a DM that mentions someone else", async () => {
    await bot.processMessage(
      adapter,
      DM_THREAD_ID,
      testMessage(
        "dm-other",
        DM_THREAD_ID,
        "<@U999> thoughts?",
        {
          raw: {
            type: "message",
            text: "<@U999> thoughts?",
          },
        },
      ),
    );

    expect(agent.invokeInputs).toEqual([
      {
        actorId: "slack:U123",
        message: "<@U999> thoughts?",
        ...slackAdaClientUser,
      },
    ]);
  });

  it("does not subscribe an unauthorized mention", async () => {
    const restrictedBot = new Chat({
      adapters: { slack: adapter },
      concurrency: "concurrent",
      logger: "silent",
      state,
      userName: BOT_NAME,
    });
    registerChatHandlers(restrictedBot, {
      agent,
      authorizedActorIds: new Set(["slack:U999"]),
      botName: BOT_NAME,
      store,
    });
    await restrictedBot.initialize();

    await restrictedBot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-restricted",
        CHANNEL_THREAD_ID,
        "List projects",
        { isMention: true },
      ),
    );

    expect(await state.isSubscribed(CHANNEL_THREAD_ID)).toBe(false);
    expect(agent.invokeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      CHANNEL_THREAD_ID,
      expect.stringMatching(/not authorized/i),
    );
  });

  it("subscribes and invokes an allowlisted mention", async () => {
    const restrictedBot = await botWithAllowlist(new Set(["slack:U123"]));

    await restrictedBot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-allowed",
        CHANNEL_THREAD_ID,
        "List projects",
        { isMention: true },
      ),
    );

    expect(await state.isSubscribed(CHANNEL_THREAD_ID)).toBe(true);
    expect(agent.invokeInputs).toEqual([
      {
        actorId: "slack:U123",
        message: "List projects",
        ...slackAdaClientUser,
      },
    ]);
  });

  it("denies an unauthorized direct message", async () => {
    const restrictedBot = await botWithAllowlist(new Set(["slack:U123"]));

    await restrictedBot.processMessage(
      adapter,
      DM_THREAD_ID,
      testMessage("dm-restricted", DM_THREAD_ID, "List projects", {
        author: { ...author(), userId: "U999" },
      }),
    );

    expect(agent.invokeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      DM_THREAD_ID,
      expect.stringMatching(/not authorized/i),
    );
  });

  it("denies an unauthorized follow-up in a subscribed thread", async () => {
    const restrictedBot = await botWithAllowlist(new Set(["slack:U123"]));
    await restrictedBot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-allowed",
        CHANNEL_THREAD_ID,
        "List projects",
        { isMention: true },
      ),
    );
    agent.invokeInputs = [];

    await restrictedBot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-follow-up",
        CHANNEL_THREAD_ID,
        "Now drop the database",
        { author: { ...author(), userId: "U999" } },
      ),
    );

    expect(await state.isSubscribed(CHANNEL_THREAD_ID)).toBe(true);
    expect(agent.invokeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      CHANNEL_THREAD_ID,
      expect.stringMatching(/not authorized/i),
    );
  });

  it("does not reply to an unauthorized bot mention", async () => {
    const restrictedBot = new Chat({
      adapters: { slack: adapter },
      concurrency: "concurrent",
      logger: "silent",
      state,
      userName: BOT_NAME,
    });
    registerChatHandlers(restrictedBot, {
      agent,
      authorizedActorIds: new Set(["slack:U999"]),
      botName: BOT_NAME,
      store,
    });
    await restrictedBot.initialize();

    await restrictedBot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-bot-restricted",
        CHANNEL_THREAD_ID,
        "Automated follow-up",
        {
          author: {
            ...author(),
            userId: "B999",
            isBot: true,
          },
          isMention: true,
          raw: {
            type: "app_mention",
            text: "<@B123> Automated follow-up",
          },
        },
      ),
    );

    expect(agent.invokeInputs).toEqual([]);
    expect(adapter.postMessage).not.toHaveBeenCalled();
  });

  describe("two bots tagged in the same message", () => {
    const BOT_A_ID = "B123";
    const BOT_B_ID = "B456";
    const BOTH_MENTIONED = `<@${BOT_A_ID}> <@${BOT_B_ID}> check this deployment`;

    async function twoBots(options: {
      authorizedActorIds?: ReadonlySet<string>;
    }) {
      const logger = { error: vi.fn(), warn: vi.fn() };
      const make = async (botUserId: string, name: string) => {
        const botAdapter = createMockAdapter("slack", {
          botUserId,
          isDM: (threadId) => threadId.startsWith("slack:D"),
        });
        const botState = createMockState();
        const botChat = new Chat({
          adapters: { slack: botAdapter },
          concurrency: "concurrent",
          logger: "silent",
          state: botState,
          userName: name,
        });
        const botAgent = new FakeAgentGateway();
        botAgent.invokeResult = completed;
        registerChatHandlers(botChat, {
          agent: botAgent,
          botName: name,
          logger,
          store: new MemoryThreadStore(),
          ...(options.authorizedActorIds
            ? { authorizedActorIds: options.authorizedActorIds }
            : {}),
        });
        await botChat.initialize();
        return {
          adapter: botAdapter,
          agent: botAgent,
          chat: botChat,
          state: botState,
        };
      };
      return {
        a: await make(BOT_A_ID, "BotA"),
        b: await make(BOT_B_ID, "BotB"),
        logger,
      };
    }

    function botReply(
      botUserId: string,
      text = "Here is what I found",
      isMention = false,
    ) {
      return testMessage(`reply-${botUserId}`, CHANNEL_THREAD_ID, text, {
        isMention,
        author: {
          ...author(),
          userId: botUserId,
          userName: botUserId,
          isBot: true,
        },
        raw: { type: "message", text, bot_id: `BOT_${botUserId}` },
      });
    }

    async function tagBoth(
      bots: Awaited<ReturnType<typeof twoBots>>,
    ) {
      for (const bot of [bots.a, bots.b]) {
        await bot.chat.processMessage(
          bot.adapter,
          CHANNEL_THREAD_ID,
          testMessage("tag-both", CHANNEL_THREAD_ID, BOTH_MENTIONED, {
            isMention: true,
            raw: { type: "message", text: BOTH_MENTIONED },
          }),
        );
      }
    }

    async function exchangeReplies(
      bots: Awaited<ReturnType<typeof twoBots>>,
    ) {
      await bots.b.chat.processMessage(
        bots.b.adapter,
        CHANNEL_THREAD_ID,
        botReply(BOT_A_ID),
      );
      await bots.a.chat.processMessage(
        bots.a.adapter,
        CHANNEL_THREAD_ID,
        botReply(BOT_B_ID),
      );
    }

    it("answers once each without a loop or denial noise", async () => {
      const bots = await twoBots({
        authorizedActorIds: new Set(["slack:U123"]),
      });

      await tagBoth(bots);
      await exchangeReplies(bots);

      expect(await bots.a.state.isSubscribed(CHANNEL_THREAD_ID)).toBe(true);
      expect(await bots.b.state.isSubscribed(CHANNEL_THREAD_ID)).toBe(true);
      expect(bots.a.agent.invokeInputs).toHaveLength(1);
      expect(bots.b.agent.invokeInputs).toHaveLength(1);
      expect(bots.a.adapter.postMessage).not.toHaveBeenCalledWith(
        CHANNEL_THREAD_ID,
        expect.stringMatching(/not authorized/i),
      );
      expect(bots.b.adapter.postMessage).not.toHaveBeenCalledWith(
        CHANNEL_THREAD_ID,
        expect.stringMatching(/not authorized/i),
      );
      expect(bots.logger.warn).not.toHaveBeenCalled();
    });

    it("does not loop when no allowlist is configured", async () => {
      const bots = await twoBots({});

      await tagBoth(bots);
      await exchangeReplies(bots);

      expect(bots.a.agent.invokeInputs).toHaveLength(1);
      expect(bots.b.agent.invokeInputs).toHaveLength(1);
    });

    it("does not loop when both bots are allowlisted", async () => {
      const bots = await twoBots({
        authorizedActorIds: new Set([
          "slack:U123",
          `slack:${BOT_A_ID}`,
          `slack:${BOT_B_ID}`,
        ]),
      });

      await tagBoth(bots);
      await exchangeReplies(bots);

      expect(bots.a.agent.invokeInputs).toHaveLength(1);
      expect(bots.b.agent.invokeInputs).toHaveLength(1);
    });

    it("still answers a thread reply from an allowlisted bot that @-mentions this bot", async () => {
      const bots = await twoBots({
        authorizedActorIds: new Set(["slack:U123", `slack:${BOT_A_ID}`]),
      });
      await tagBoth(bots);
      const text = `<@${BOT_B_ID}> please double-check`;

      await bots.b.chat.processMessage(
        bots.b.adapter,
        CHANNEL_THREAD_ID,
        botReply(BOT_A_ID, text, true),
      );

      expect(bots.b.agent.invokeInputs).toHaveLength(2);
      expect(bots.b.agent.invokeInputs[1]?.message).toBe(text);
    });

    it("ignores a bot message that names this bot without a structured mention", async () => {
      const bots = await twoBots({});
      await tagBoth(bots);

      await bots.b.chat.processMessage(
        bots.b.adapter,
        CHANNEL_THREAD_ID,
        botReply(BOT_A_ID, "Thanks @BotB, done", true),
      );

      expect(bots.b.agent.invokeInputs).toHaveLength(1);
    });
  });

  it.each([
    [REVIEW_APPROVE_ACTION_ID, "approve"],
    [REVIEW_REJECT_ACTION_ID, "reject"],
  ] as const)(
    "routes %s actions using signed event context",
    async (actionId, decision) => {
      await seedPendingReview(store);

      await bot.processAction(
        {
          actionId,
          adapter,
          messageId: "review-message",
          raw: {},
          threadId: CHANNEL_THREAD_ID,
          user: author(),
          value: "interrupt-1",
        },
        undefined,
      );

      expect(agent.resumeInputs[0]).toMatchObject({
        actorId: "slack:U123",
        interruptId: "interrupt-1",
        ...slackAdaClientUser,
        decision: expect.arrayContaining([
          expect.objectContaining({ type: decision }),
        ]),
      });
      expect(adapter.editMessage).toHaveBeenCalledWith(
        CHANNEL_THREAD_ID,
        "review-message",
        expect.any(String),
      );
    },
  );

  it.each([REVIEW_APPROVE_ACTION_ID, REVIEW_REJECT_ACTION_ID] as const)(
    "denies a non-allowlisted actor's %s action",
    async (actionId) => {
      const restrictedBot = new Chat({
        adapters: { slack: adapter },
        concurrency: "concurrent",
        logger: "silent",
        state,
        userName: BOT_NAME,
      });
      registerChatHandlers(restrictedBot, {
        agent,
        authorizedActorIds: new Set(["slack:U123"]),
        botName: BOT_NAME,
        store,
      });
      await restrictedBot.initialize();
      await seedPendingReview(store);

      await restrictedBot.processAction(
        {
          actionId,
          adapter,
          messageId: "review-message",
          raw: {},
          threadId: CHANNEL_THREAD_ID,
          user: { ...author(), userId: "U999" },
          value: "interrupt-1",
        },
        undefined,
      );

      expect(agent.resumeInputs).toEqual([]);
      expect(adapter.postMessage).toHaveBeenCalledWith(
        CHANNEL_THREAD_ID,
        expect.stringMatching(/not authorized/i),
      );
      expect(await store.get(CHANNEL_THREAD_ID)).toMatchObject({
        pendingInterruptId: "interrupt-1",
      });
    },
  );

  it("denies an allowlisted actor who did not request the review", async () => {
    const restrictedBot = await botWithAllowlist(
      new Set(["slack:U123", "slack:U999"]),
    );
    await seedPendingReview(store);

    await restrictedBot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter,
        messageId: "review-message",
        raw: {},
        threadId: CHANNEL_THREAD_ID,
        user: { ...author(), userId: "U999" },
        value: "interrupt-1",
      },
      undefined,
    );

    expect(agent.resumeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      CHANNEL_THREAD_ID,
      expect.stringMatching(/only the requester/i),
    );
    expect(await store.get(CHANNEL_THREAD_ID)).toMatchObject({
      pendingInterruptId: "interrupt-1",
    });
  });

  it("ignores a forged actor in the action value and uses signed user context", async () => {
    const restrictedBot = await botWithAllowlist(new Set(["slack:U123"]));
    await seedPendingReview(store);

    await restrictedBot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter,
        messageId: "review-message",
        raw: {},
        threadId: CHANNEL_THREAD_ID,
        user: { ...author(), userId: "U999" },
        value: "slack:U123",
      },
      undefined,
    );

    expect(agent.resumeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      CHANNEL_THREAD_ID,
      expect.stringMatching(/not authorized/i),
    );
  });

  it("rejects an adapter that cannot resolve the interrupt id", async () => {
    const restrictedBot = new Chat({
      adapters: { slack: adapter },
      concurrency: "concurrent",
      logger: "silent",
      state,
      userName: BOT_NAME,
    });
    registerChatHandlers(restrictedBot, {
      agent,
      authorizedActorIds: new Set(["slack:U123"]),
      botName: BOT_NAME,
      reviewInterruptIdForAdapter: () => null,
      store,
    });
    await restrictedBot.initialize();
    await seedPendingReview(store);

    await restrictedBot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter,
        messageId: "review-message",
        raw: {},
        threadId: CHANNEL_THREAD_ID,
        user: author(),
        value: JSON.stringify({
          channelId: "C999",
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
  });

  it("rejects empty action values without resuming", async () => {
    await bot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter,
        messageId: "review-message",
        raw: {},
        threadId: CHANNEL_THREAD_ID,
        user: author(),
        value: "",
      },
      undefined,
    );

    expect(agent.resumeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      CHANNEL_THREAD_ID,
      expect.stringMatching(/invalid or expired/i),
    );
  });

  it("delegates legacy action-value translation to the platform boundary", async () => {
    await seedPendingReview(store);

    await bot.processAction(
      {
        actionId: REVIEW_APPROVE_ACTION_ID,
        adapter,
        messageId: "legacy-review-message",
        raw: {},
        threadId: CHANNEL_THREAD_ID,
        user: author(),
        value: "legacy-review-value",
      },
      undefined,
    );

    expect(agent.resumeInputs[0]?.interruptId).toBe("interrupt-1");
  });

  it("keeps Chat SDK concurrency configured as concurrent", async () => {
    const first = testMessage(
      "message-1",
      DM_THREAD_ID,
      "First",
    );
    const second = testMessage(
      "message-2",
      DM_THREAD_ID,
      "Second",
    );
    let release!: () => void;
    agent.invokeStream = vi.fn(async (input) => {
      agent.invokeInputs.push(input);
      if (input.message === "First") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return completed;
    });

    const firstRun = bot.processMessage(adapter, DM_THREAD_ID, first);
    await vi.waitFor(() => expect(agent.invokeInputs).toHaveLength(1));
    const secondRun = bot.processMessage(adapter, DM_THREAD_ID, second);
    await vi.waitFor(() =>
      expect(adapter.postMessage).toHaveBeenCalledWith(
        DM_THREAD_ID,
        expect.stringMatching(/already working/i),
      ),
    );
    release();
    await Promise.all([firstRun, secondRun]);

    expect(agent.invokeInputs).toHaveLength(1);
  });

  async function botWithAllowlist(
    authorizedActorIds: ReadonlySet<string>,
  ) {
    const restrictedBot = new Chat({
      adapters: { slack: adapter },
      concurrency: "concurrent",
      logger: "silent",
      state,
      userName: BOT_NAME,
    });
    registerChatHandlers(restrictedBot, {
      agent,
      authorizedActorIds,
      botName: BOT_NAME,
      store,
    });
    await restrictedBot.initialize();
    return restrictedBot;
  }
});

function testMessage(
  id: string,
  threadId: string,
  text: string,
  overrides: {
    author?: Author;
    isMention?: boolean;
    raw?: unknown;
  } = {},
) {
  return createTestMessage(id, text, {
    threadId,
    author: author(),
    ...overrides,
  });
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
