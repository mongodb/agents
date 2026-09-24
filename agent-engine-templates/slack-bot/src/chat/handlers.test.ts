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
      userName: "AtlasExplorer",
    });
    agent = new FakeAgentGateway();
    agent.invokeResult = completed;
    agent.resumeResult = completed;
    store = new MemoryThreadStore();
    registerChatHandlers(bot, {
      agent,
      reviewInterruptIdForAdapter: (
        _adapter,
        value,
        _threadId,
      ) => (value === "legacy-review-value" ? "interrupt-1" : value),
      store,
    });
    await bot.initialize();
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
      userName: "AtlasExplorer",
    });
    registerChatHandlers(restrictedBot, {
      agent,
      authorizedActorIds: new Set(["slack:U999"]),
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
      userName: "AtlasExplorer",
    });
    registerChatHandlers(restrictedBot, {
      agent,
      authorizedActorIds: new Set(["slack:U999"]),
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
        userName: "AtlasExplorer",
      });
      registerChatHandlers(restrictedBot, {
        agent,
        authorizedActorIds: new Set(["slack:U123"]),
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
      userName: "AtlasExplorer",
    });
    registerChatHandlers(restrictedBot, {
      agent,
      authorizedActorIds: new Set(["slack:U123"]),
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
      userName: "AtlasExplorer",
    });
    registerChatHandlers(restrictedBot, {
      agent,
      authorizedActorIds,
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
