import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryThreadStore } from "../store/memoryThreadStore.js";
import type { ThreadStore } from "../store/threadStore.js";
import {
  createProgressHandler,
  handleConversationMessage,
  recoverPendingDelivery,
} from "./conversation.js";
import {
  callingTool,
  completed,
  FakeAgentGateway,
  FakeConversation,
  seedPendingReview,
  suspended,
} from "./handlers.test-helpers.js";

const THREAD_ID = "slack:C123:1720000000.000100";
const ACTOR_ID = "slack:U123";

describe("handleConversationMessage", () => {
  let agent: FakeAgentGateway;
  let conversation: FakeConversation;
  let store: ThreadStore;

  beforeEach(() => {
    agent = new FakeAgentGateway();
    conversation = new FakeConversation();
    store = new MemoryThreadStore();
  });

  it("starts a session with a platform-qualified actor and reuses it", async () => {
    agent.invokeResult = completed;
    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "List projects",
      },
      { agent, conversation, store },
    );

    agent.invokeResult = {
      ...completed,
      response: "The first project has two clusters.",
    };
    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-2",
        actorId: ACTOR_ID,
        text: "What about the first?",
      },
      { agent, conversation, store },
    );

    expect(agent.invokeInputs).toEqual([
      {
        message: "List projects",
        actorId: ACTOR_ID,
      },
      {
        message: "What about the first?",
        actorId: ACTOR_ID,
        sessionId: "session-1",
      },
    ]);
    expect(await store.get(THREAD_ID)).toMatchObject({
      magentaSessionId: "session-1",
    });
  });

  it("enforces a platform-neutral allowlist", async () => {
    agent.invokeResult = completed;
    const logger = { error: vi.fn(), warn: vi.fn() };

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "List projects",
      },
      {
        agent,
        conversation,
        logger,
        store,
        authorizedActorIds: new Set(["discord:U123"]),
      },
    );

    expect(agent.invokeInputs).toEqual([]);
    expect(conversation.messages[0]).toMatch(/not authorized/i);
    expect(logger.warn).toHaveBeenCalledWith("Rejected unauthorized actor", {
      actorId: ACTOR_ID,
    });
  });

  it("lets an allowlisted actor invoke", async () => {
    agent.invokeResult = completed;

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "List projects",
      },
      {
        agent,
        conversation,
        store,
        authorizedActorIds: new Set([ACTOR_ID, "slack:U999"]),
      },
    );

    expect(agent.invokeInputs).toEqual([
      {
        message: "List projects",
        actorId: ACTOR_ID,
      },
    ]);
  });

  it("forwards client and user extras to Magenta", async () => {
    agent.invokeResult = completed;
    const user = {
      id: "U123",
      username: "ada",
      full_name: "Ada Lovelace",
      actor_id: ACTOR_ID,
    };

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "List projects",
        client: "slack",
        user,
      },
      { agent, conversation, store },
    );

    expect(agent.invokeInputs).toEqual([
      {
        message: "List projects",
        actorId: ACTOR_ID,
        client: "slack",
        user,
      },
    ]);
  });

  it("silently rejects an unauthorized bot", async () => {
    agent.invokeResult = completed;
    const logger = { error: vi.fn(), warn: vi.fn() };

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: "slack:B999",
        authorIsBot: true,
        text: "Automated follow-up",
      },
      {
        agent,
        conversation,
        logger,
        store,
        authorizedActorIds: new Set(["slack:U123"]),
      },
    );

    expect(agent.invokeInputs).toEqual([]);
    expect(conversation.messages).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Rejected unauthorized actor",
      {
        actorId: "slack:B999",
      },
    );
  });

  it("allows an explicitly authorized bot", async () => {
    agent.invokeResult = completed;

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: "slack:B123",
        authorIsBot: true,
        text: "Run scheduled report",
      },
      {
        agent,
        conversation,
        store,
        authorizedActorIds: new Set(["slack:B123"]),
      },
    );

    expect(agent.invokeInputs).toEqual([
      {
        actorId: "slack:B123",
        message: "Run scheduled report",
      },
    ]);
  });

  it("does not expose a pending review to a non-allowlisted actor", async () => {
    await seedPendingReview(store);

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-unauthorized",
        actorId: "slack:U999",
        text: "Approve it",
      },
      {
        agent,
        conversation,
        store,
        authorizedActorIds: new Set([ACTOR_ID]),
      },
    );

    expect(agent.invokeInputs).toEqual([]);
    expect(agent.resumeInputs).toEqual([]);
    expect(conversation.messages).toEqual([
      expect.stringMatching(/not authorized/i),
    ]);
  });

  it("stores every interrupt and posts a cross-platform review card", async () => {
    agent.invokeResult = suspended;

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "Insert an item",
      },
      { agent, conversation, store },
    );

    expect(await store.get(THREAD_ID)).toMatchObject({
      pendingInterruptId: "interrupt-1",
      pendingInterrupts: suspended.interrupts,
      pendingRequestedByActorId: ACTOR_ID,
    });
    expect(conversation.messages[0]).toMatchObject({
      card: expect.objectContaining({ type: "card" }),
      fallbackText: expect.stringMatching(/requires approval/i),
    });
  });

  it("keeps durable turn claims authoritative under concurrent handlers", async () => {
    agent.invokeResult = completed;
    let release!: () => void;
    conversation.deliveryGate = new Promise((resolve) => {
      release = resolve;
    });

    const first = handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "List projects",
      },
      { agent, conversation, store },
    );
    await vi.waitFor(() => expect(agent.invokeInputs).toHaveLength(1));

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-2",
        actorId: ACTOR_ID,
        text: "Another request",
      },
      { agent, conversation, store },
    );

    expect(agent.invokeInputs).toHaveLength(1);
    expect(conversation.messages).toContainEqual(
      expect.stringMatching(/already/i),
    );
    release();
    await first;
  });

  it("recovers a pending delivery during later thread activity", async () => {
    agent.invokeResult = completed;
    conversation.deliveryError = new Error("delivery failed");
    let now = new Date("2026-09-09T12:00:00.000Z");
    store = new MemoryThreadStore({
      now: () => now.getTime(),
    });
    const original = {
      threadId: THREAD_ID,
      eventId: "event-1",
      actorId: ACTOR_ID,
      text: "List projects",
    };

    await handleConversationMessage(original, {
      agent,
      conversation,
      store,
      now: () => now,
    });
    conversation.deliveryError = undefined;
    now = new Date("2026-09-09T12:06:00.000Z");
    agent.invokeResult = {
      ...completed,
      response: "I am here.",
    };

    await handleConversationMessage(
      {
        ...original,
        eventId: "event-2",
        text: "Are you there?",
      },
      { agent, conversation, store, now: () => now },
    );

    expect(conversation.agentResponses).toEqual([
      completed.response,
      "I am here.",
    ]);
    expect(agent.invokeInputs).toHaveLength(2);
    expect(await store.get(THREAD_ID)).not.toHaveProperty(
      "pendingDelivery",
    );
  });

  it("reconciles a response accepted before an ambiguous delivery error", async () => {
    agent.invokeResult = completed;
    conversation.deliveryError = new Error("response lost");
    conversation.acceptDeliveryBeforeError = true;
    let now = new Date("2026-09-09T12:00:00.000Z");
    store = new MemoryThreadStore({
      now: () => now.getTime(),
    });
    const input = {
      threadId: THREAD_ID,
      eventId: "event-1",
      actorId: ACTOR_ID,
      text: "List projects",
    };

    await handleConversationMessage(input, {
      agent,
      conversation,
      store,
      now: () => now,
    });
    conversation.deliveryError = undefined;
    now = new Date("2026-09-09T12:06:00.000Z");

    await recoverPendingDelivery(THREAD_ID, {
      agent,
      conversation,
      store,
      now: () => now,
    });

    expect(conversation.deliveryAttempts).toBe(1);
    expect(await store.get(THREAD_ID)).not.toHaveProperty(
      "pendingDelivery",
    );
  });

  it("does not risk a duplicate when a future adapter cannot reconcile delivery", async () => {
    await store.put({
      threadId: THREAD_ID,
      pendingDelivery: {
        id: "delivery-1",
        text: "Stored result",
        state: "pending",
        attemptCount: 1,
      },
      retentionState: "delivery_pending",
      updatedAt: new Date(),
    });
    conversation.unknownDeliveryStatus = true;

    await expect(
      recoverPendingDelivery(THREAD_ID, {
        agent,
        conversation,
        store,
      }),
    ).resolves.toBe("uncertain");

    expect(conversation.deliveryAttempts).toBe(0);
    expect(await store.get(THREAD_ID)).toHaveProperty(
      "pendingDelivery",
    );
  });

  it.each([1, 4, 12])(
    "keeps the init status through a skill-load burst of %s downloads",
    async (downloadCount) => {
      agent.invokeResult = completed;
      agent.progressEvents = [
        ...skillLoadBurst(downloadCount),
        callingTool("mongodb__atlas_list_projects"),
      ];

      await handleConversationMessage(
        {
          threadId: THREAD_ID,
          eventId: "event-1",
          actorId: ACTOR_ID,
          text: "List projects",
        },
        { agent, conversation, store },
      );

      expect(conversation.statuses).toEqual([
        "Initializing AtlasExplorer…",
        "Calling tool: mongodb__atlas_list_projects...",
      ]);
    },
  );

  it("shows a directory listing that happens after skill loading in the same turn", async () => {
    agent.invokeResult = completed;
    agent.progressEvents = [
      callingTool("filesystem_ls"),
      callingTool("filesystem_download"),
      callingTool("filesystem_ls"),
    ];

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "List projects",
      },
      { agent, conversation, store },
    );

    expect(conversation.statuses).toEqual([
      "Initializing AtlasExplorer…",
      "Calling tool: filesystem_ls...",
    ]);
  });

  it("shows a leading directory listing in an existing session", async () => {
    await store.put({
      threadId: THREAD_ID,
      magentaSessionId: "session-1",
      updatedAt: new Date(),
    });
    agent.invokeResult = completed;
    agent.progressEvents = [callingTool("filesystem_ls")];

    await handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "List the workspace files",
      },
      { agent, conversation, store },
    );

    expect(conversation.statuses).toEqual([
      "Initializing AtlasExplorer…",
      "Calling tool: filesystem_ls...",
    ]);
  });
});

describe("createProgressHandler", () => {
  let conversation: FakeConversation;
  let handler: ReturnType<typeof createProgressHandler>;

  beforeEach(() => {
    conversation = new FakeConversation();
    handler = createProgressHandler(conversation, undefined, false);
  });

  it("shows filesystem_ls by default", async () => {
    const defaultHandler = createProgressHandler(conversation);

    await defaultHandler(callingTool("filesystem_ls"));

    expect(conversation.statuses).toEqual([
      "Calling tool: filesystem_ls...",
    ]);
  });

  it.each([1, 4, 12])(
    "hides an init skill-load burst of %s downloads",
    async (downloadCount) => {
      for (const progress of skillLoadBurst(downloadCount)) {
        await handler(progress);
      }

      expect(conversation.statuses).toEqual([]);
    },
  );

  it("shows Atlas MCP tools after the skill-load burst", async () => {
    await handler(callingTool("filesystem_ls"));
    await handler(callingTool("filesystem_download"));
    await handler(callingTool("mongodb__atlas_list_projects"));

    expect(conversation.statuses).toEqual([
      "Calling tool: mongodb__atlas_list_projects...",
    ]);
  });

  it("shows filesystem_ls immediately after a skill-load download", async () => {
    await handler(callingTool("filesystem_ls"));
    await handler(callingTool("filesystem_download"));
    await handler(callingTool("filesystem_ls"));

    expect(conversation.statuses).toEqual([
      "Calling tool: filesystem_ls...",
    ]);
  });

  it("shows filesystem ls, grep, and read after skill loading", async () => {
    await handler(callingTool("filesystem_ls"));
    await handler(callingTool("filesystem_download"));
    await handler(callingTool("filesystem_ls"));
    await handler(callingTool("filesystem_grep"));
    await handler(callingTool("filesystem_read"));

    expect(conversation.statuses).toEqual([
      "Calling tool: filesystem_ls...",
      "Calling tool: filesystem_grep...",
      "Calling tool: filesystem_read...",
    ]);
  });

  it("shows a stream that starts with ls then grep in an existing session", async () => {
    handler = createProgressHandler(conversation, undefined, true);
    await handler(callingTool("filesystem_ls"));
    await handler(callingTool("filesystem_grep"));

    expect(conversation.statuses).toEqual([
      "Calling tool: filesystem_ls...",
      "Calling tool: filesystem_grep...",
    ]);
  });

  it("shows consecutive directory listings in an existing session", async () => {
    handler = createProgressHandler(conversation, undefined, true);
    await handler(callingTool("filesystem_ls"));
    await handler(callingTool("filesystem_ls"));

    expect(conversation.statuses).toEqual([
      "Calling tool: filesystem_ls...",
      "Calling tool: filesystem_ls...",
    ]);
  });

  it("forwards a stream that starts with grep immediately", async () => {
    await handler(callingTool("filesystem_grep"));

    expect(conversation.statuses).toEqual([
      "Calling tool: filesystem_grep...",
    ]);
  });

  it("never shows filesystem_download even without a preceding ls", async () => {
    await handler(callingTool("filesystem_download"));
    await handler(callingTool("mongodb__atlas_list_projects"));

    expect(conversation.statuses).toEqual([
      "Calling tool: mongodb__atlas_list_projects...",
    ]);
  });

  it("shows filesystem_ls after a download even when no init ls preceded it", async () => {
    await handler(callingTool("filesystem_download"));
    await handler(callingTool("filesystem_ls"));

    expect(conversation.statuses).toEqual([
      "Calling tool: filesystem_ls...",
    ]);
  });

  it("keeps hiding filesystem_download after a user-facing tool", async () => {
    await handler(callingTool("mongodb__atlas_list_projects"));
    await handler(callingTool("filesystem_download"));
    await handler(callingTool("filesystem_grep"));

    expect(conversation.statuses).toEqual([
      "Calling tool: mongodb__atlas_list_projects...",
      "Calling tool: filesystem_grep...",
    ]);
  });

  it("ignores empty progress content", async () => {
    await handler({ content: "   ", toolName: "mongodb__atlas_list_projects" });

    expect(conversation.statuses).toEqual([]);
  });

  it("caps forwarded status text at 100 characters", async () => {
    const content = `Calling tool: ${"a".repeat(200)}`;
    await handler({
      content,
      toolName: "mongodb__atlas_list_projects",
    });

    expect(conversation.statuses).toEqual([content.slice(0, 100)]);
  });

  it("logs when Slack status updates fail", async () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    conversation.setStatus = async () => {
      throw new Error("status failed");
    };
    handler = createProgressHandler(conversation, logger);

    await handler(callingTool("mongodb__atlas_list_projects"));

    expect(logger.warn).toHaveBeenCalledWith(
      "Could not update conversation progress status",
      expect.any(Error),
    );
  });
});

function skillLoadBurst(downloadCount: number) {
  return [
    callingTool("filesystem_ls"),
    ...Array.from({ length: downloadCount }, () =>
      callingTool("filesystem_download"),
    ),
  ];
}
