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

  it("unsubscribes when any ten messages flood a thread", async () => {
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
    await state.subscribe(CHANNEL_THREAD_ID);

    for (let index = 0; index < 9; index += 1) {
      const isBot = index < 5;
      await restrictedBot.processMessage(
        adapter,
        CHANNEL_THREAD_ID,
        testMessage(
          `message-flood-${index}`,
          CHANNEL_THREAD_ID,
          `Message ${index}`,
          {
            author: {
              ...author(),
              userId: isBot ? "B999" : "U123",
              isBot,
            },
          },
        ),
      );
    }

    expect(await state.isSubscribed(CHANNEL_THREAD_ID)).toBe(true);

    await restrictedBot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-flood-9",
        CHANNEL_THREAD_ID,
        "Authorized message",
        {
          author: {
            ...author(),
            userId: "U999",
          },
        },
      ),
    );

    expect(await state.isSubscribed(CHANNEL_THREAD_ID)).toBe(false);
    expect(agent.invokeInputs).toEqual([]);
    expect(adapter.postMessage).toHaveBeenCalledWith(
      CHANNEL_THREAD_ID,
      expect.stringMatching(/left this thread/i),
    );
    expect(
      vi.mocked(adapter.postMessage).mock.calls.filter(
        ([, message]) =>
          typeof message === "string" &&
          /left this thread/i.test(message),
      ),
    ).toHaveLength(1);

    const replyCount = vi.mocked(adapter.postMessage).mock.calls.length;
    await restrictedBot.processMessage(
      adapter,
      CHANNEL_THREAD_ID,
      testMessage(
        "message-after-flood",
        CHANNEL_THREAD_ID,
        "One more",
      ),
    );
    expect(vi.mocked(adapter.postMessage).mock.calls).toHaveLength(
      replyCount,
    );
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
