import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgenticApiError } from "../agent-engine/client.js";
import { MemoryThreadStore } from "../store/memoryThreadStore.js";
import type { ThreadStore } from "../store/threadStore.js";
import {
  completed,
  callingTool,
  FakeAgentGateway,
  FakeConversation,
  seedPendingReview,
} from "./handlers.test-helpers.js";
import { handleReviewDecision } from "./review.js";

const BOT_NAME = "TestBot";
const THREAD_ID = "slack:C123:1720000000.000100";
const ACTOR_ID = "slack:U123";

describe("handleReviewDecision", () => {
  let agent: FakeAgentGateway;
  let conversation: FakeConversation;
  let store: ThreadStore;

  beforeEach(() => {
    agent = new FakeAgentGateway();
    conversation = new FakeConversation();
    store = new MemoryThreadStore();
  });

  it("resumes every action and pending interrupt exactly once", async () => {
    await store.put({
      threadId: THREAD_ID,
      agentSessionId: "session-1",
      pendingInterruptId: "interrupt-1",
      pendingInterrupts: [
        {
          id: "interrupt-1",
          actionRequests: [
            { name: "insert", args: {} },
            { name: "update", args: {} },
          ],
        },
        {
          id: "interrupt-2",
          actionRequests: [{ name: "createIndex", args: {} }],
        },
      ],
      pendingRequestedByActorId: ACTOR_ID,
      pendingReviewState: "pending",
      updatedAt: new Date(),
    });
    agent.resumeResult = completed;
    const decision = {
      threadId: THREAD_ID,
      interruptId: "interrupt-1",
      actorId: ACTOR_ID,
      decision: "approve" as const,
    };

    const outcomes = await Promise.all([
      handleReviewDecision(decision, {
        agent,
        conversation,
        store,
        botName: BOT_NAME,
      }),
      handleReviewDecision(decision, {
        agent,
        conversation,
        store,
        botName: BOT_NAME,
      }),
    ]);

    expect(agent.resumeInputs).toEqual([
      {
        sessionId: "session-1",
        actorId: ACTOR_ID,
        interruptId: "interrupt-1",
        decision: [{ type: "approve" }, { type: "approve" }],
        additionalInterrupts: [
          {
            interruptId: "interrupt-2",
            decision: [{ type: "approve" }],
          },
        ],
      },
    ]);
    expect(outcomes).toContain("completed");
    expect(outcomes).toContain("missing");
  });

  it("forwards client and user extras to Agent Engine", async () => {
    await seedPendingReview(store);
    agent.resumeResult = completed;
    const user = {
      id: "U123",
      username: "ada",
      full_name: "Ada Lovelace",
      actor_id: ACTOR_ID,
    };

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: ACTOR_ID,
        decision: "approve",
        client: "slack",
        user,
      },
      { agent, conversation, store, botName: BOT_NAME },
    );

    expect(outcome).toBe("completed");
    expect(agent.resumeInputs[0]).toMatchObject({
      actorId: ACTOR_ID,
      client: "slack",
      user,
    });
  });

  it.each(["approve", "reject"] as const)(
    "restricts %s decisions to the original platform-qualified actor",
    async (decision) => {
      await seedPendingReview(store);

      const outcome = await handleReviewDecision(
        {
          threadId: THREAD_ID,
          interruptId: "interrupt-1",
          actorId: "slack:U999",
          decision,
        },
        { agent, conversation, store, botName: BOT_NAME },
      );

      expect(outcome).toBe("unauthorized");
      expect(agent.resumeInputs).toEqual([]);
      expect(conversation.messages[0]).toMatch(/only the requester/i);
    },
  );

  it.each(["approve", "reject"] as const)(
    "denies a non-allowlisted actor who tries to %s a pending review",
    async (decision) => {
      await seedPendingReview(store);
      const logger = { error: vi.fn(), warn: vi.fn() };

      const outcome = await handleReviewDecision(
        {
          threadId: THREAD_ID,
          interruptId: "interrupt-1",
          actorId: "slack:U999",
          decision,
        },
        {
          agent,
          conversation,
          logger,
          store,
          botName: BOT_NAME,
          authorizedActorIds: new Set([ACTOR_ID]),
        },
      );

      expect(outcome).toBe("unauthorized");
      expect(agent.resumeInputs).toEqual([]);
      expect(conversation.messages[0]).toMatch(/not authorized/i);
      expect(logger.warn).toHaveBeenCalledWith(
        "Rejected unauthorized actor",
        { actorId: "slack:U999" },
      );
      expect(await store.get(THREAD_ID)).toMatchObject({
        pendingInterruptId: "interrupt-1",
      });
    },
  );

  it("still restricts allowlisted decisions to the original requester", async () => {
    await seedPendingReview(store);

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: "slack:U999",
        decision: "approve",
      },
      {
        agent,
        conversation,
        store,
        botName: BOT_NAME,
        authorizedActorIds: new Set([ACTOR_ID, "slack:U999"]),
      },
    );

    expect(outcome).toBe("unauthorized");
    expect(agent.resumeInputs).toEqual([]);
    expect(conversation.messages[0]).toMatch(/only the requester/i);
  });

  it("does not treat the same user id on another platform as the requester", async () => {
    await seedPendingReview(store);

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: "discord:U123",
        decision: "approve",
      },
      {
        agent,
        conversation,
        store,
        botName: BOT_NAME,
        authorizedActorIds: new Set([ACTOR_ID, "discord:U123"]),
      },
    );

    expect(outcome).toBe("unauthorized");
    expect(agent.resumeInputs).toEqual([]);
    expect(conversation.messages[0]).toMatch(/only the requester/i);
  });

  it("refuses a pending review that has no recorded requester", async () => {
    await store.put({
      threadId: THREAD_ID,
      agentSessionId: "session-1",
      pendingInterruptId: "interrupt-1",
      pendingActionRequests: [{ name: "mongodb__insert_many", args: {} }],
      pendingReviewState: "pending",
      updatedAt: new Date(),
    });
    agent.resumeResult = completed;

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: ACTOR_ID,
        decision: "approve",
      },
      {
        agent,
        conversation,
        store,
        botName: BOT_NAME,
        authorizedActorIds: new Set([ACTOR_ID]),
      },
    );

    expect(outcome).toBe("unauthorized");
    expect(agent.resumeInputs).toEqual([]);
    expect(conversation.messages[0]).toMatch(/only the requester/i);
    expect(await store.get(THREAD_ID)).toMatchObject({
      pendingInterruptId: "interrupt-1",
    });
  });

  it("leaves the review claim available after an unauthorized attempt", async () => {
    await seedPendingReview(store);
    agent.resumeResult = completed;

    await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: "slack:U999",
        decision: "approve",
      },
      {
        agent,
        conversation,
        store,
        botName: BOT_NAME,
        authorizedActorIds: new Set([ACTOR_ID]),
      },
    );

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: ACTOR_ID,
        decision: "approve",
      },
      {
        agent,
        conversation,
        store,
        botName: BOT_NAME,
        authorizedActorIds: new Set([ACTOR_ID]),
      },
    );

    expect(outcome).toBe("completed");
    expect(agent.resumeInputs).toHaveLength(1);
  });

  it("allows the original allowlisted requester to approve", async () => {
    await seedPendingReview(store);
    agent.resumeResult = completed;

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: ACTOR_ID,
        decision: "approve",
      },
      {
        agent,
        conversation,
        store,
        botName: BOT_NAME,
        authorizedActorIds: new Set([ACTOR_ID]),
      },
    );

    expect(outcome).toBe("completed");
    expect(agent.resumeInputs).toHaveLength(1);
  });

  it("rejects stale action values and preserves the newer interrupt", async () => {
    await seedPendingReview(store);

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-old",
        actorId: ACTOR_ID,
        decision: "reject",
      },
      { agent, conversation, store, botName: BOT_NAME },
    );

    expect(outcome).toBe("missing");
    expect(agent.resumeInputs).toEqual([]);
    expect(await store.get(THREAD_ID)).toMatchObject({
      pendingInterruptId: "interrupt-1",
    });
  });

  it("marks ambiguous resume outcomes uncertain and edits the review", async () => {
    await seedPendingReview(store);
    agent.resumeError = new AgenticApiError(
      "response lost",
      {
        status: 0,
        code: "REQUEST_FAILED",
        requestOutcome: "unknown",
      },
    );

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: ACTOR_ID,
        decision: "approve",
      },
      { agent, conversation, store, botName: BOT_NAME },
    );

    expect(outcome).toBe("uncertain");
    expect(await store.get(THREAD_ID)).toMatchObject({
      pendingReviewState: "uncertain",
    });
    expect(conversation.reviewStatuses).toEqual(["uncertain"]);
  });

  it("shows a leading directory listing when resuming an existing session", async () => {
    await seedPendingReview(store);
    agent.resumeResult = completed;
    agent.progressEvents = [
      callingTool("filesystem_ls"),
      callingTool("mongodb__insert_many"),
    ];

    await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: ACTOR_ID,
        decision: "approve",
      },
      { agent, conversation, store, botName: BOT_NAME },
    );

    expect(conversation.statuses).toEqual([
      "Applying approved operation…",
      "Calling tool: filesystem_ls...",
      "Calling tool: mongodb__insert_many...",
    ]);
  });

  it("keeps a review pending when authentication fails before dispatch", async () => {
    await seedPendingReview(store);
    agent.resumeError = new AgenticApiError(
      "token endpoint unavailable",
      {
        status: 0,
        code: "AUTHENTICATION_FAILED",
        requestOutcome: "not_sent",
      },
    );

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: ACTOR_ID,
        decision: "approve",
      },
      { agent, conversation, store, botName: BOT_NAME },
    );

    expect(outcome).toBe("failed");
    expect(await store.get(THREAD_ID)).toMatchObject({
      pendingReviewState: "pending",
    });
    expect(conversation.messages).toContain(
      `${BOT_NAME} could not apply that decision. The review is still pending; please try again.`,
    );
  });

  it("keeps a confirmed-invalid resume pending for another attempt", async () => {
    await seedPendingReview(store);
    agent.resumeError = new AgenticApiError(
      "invalid resume map",
      {
        status: 409,
        code: "RESUME_INPUT_INVALID",
        requestOutcome: "rejected",
      },
    );

    const outcome = await handleReviewDecision(
      {
        threadId: THREAD_ID,
        interruptId: "interrupt-1",
        actorId: ACTOR_ID,
        decision: "reject",
      },
      { agent, conversation, store, botName: BOT_NAME },
    );

    expect(outcome).toBe("failed");
    expect(await store.get(THREAD_ID)).toMatchObject({
      pendingReviewState: "pending",
    });
  });
});
