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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgenticApiError } from "../agent-engine/client.js";
import { MemoryThreadStore } from "../store/memoryThreadStore.js";
import { handleConversationMessage } from "./conversation.js";
import {
  completed,
  FakeAgentGateway,
  FakeConversation,
} from "./handlers.test-helpers.js";
import {
  defaultAgentChatMessages,
  type AgentChatMessages,
} from "./messages.js";
import type { SessionLimit } from "./sessionHealth.js";

const BOT_NAME = "TestBot";
const ACTOR_ID = "slack:U123";
const THREAD_ID = "slack:C123:1720000000.000100";
const MINUTE = 60_000;
const LIMIT_MESSAGE = /hourly limit for starting or resuming conversations/;

function createLogger() {
  return { error: vi.fn(), warn: vi.fn() };
}

describe("handleConversationMessage session limit", () => {
  let agent: FakeAgentGateway;
  let conversation: FakeConversation;
  let clock: Date;
  let store: MemoryThreadStore;
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    agent = new FakeAgentGateway();
    agent.invokeResult = completed;
    conversation = new FakeConversation();
    clock = new Date("2026-09-08T12:00:00.000Z");
    store = new MemoryThreadStore({ now: () => clock.getTime() });
    logger = createLogger();
  });

  function minutesAgo(minutes: number): Date {
    return new Date(clock.getTime() - minutes * MINUTE);
  }

  async function seedActiveSession(
    name: string,
    minutes: number,
  ): Promise<void> {
    await store.put({
      threadId: `slack:C123:${name}`,
      agentSessionId: `session-${name}`,
      updatedAt: minutesAgo(minutes),
    });
  }

  function send(
    eventId: string,
    options: {
      messages?: AgentChatMessages;
      sessionLimit?: SessionLimit | null;
      threadId?: string;
    } = {},
  ): Promise<void> {
    const sessionLimit =
      options.sessionLimit === undefined
        ? { limit: 2, idleTtlMs: 10 * MINUTE }
        : options.sessionLimit;
    return handleConversationMessage(
      {
        threadId: options.threadId ?? THREAD_ID,
        eventId,
        actorId: ACTOR_ID,
        text: "List projects",
      },
      {
        agent,
        botName: BOT_NAME,
        conversation,
        logger,
        now: () => clock,
        store,
        ...(options.messages ? { messages: options.messages } : {}),
        ...(sessionLimit ? { sessionLimit } : {}),
      },
    );
  }

  it("starts a session while other active sessions are under the limit", async () => {
    await seedActiveSession("other-1", 5);

    await send("event-1");

    expect(agent.invokeInputs).toHaveLength(1);
    expect(conversation.messages).toEqual([]);
    expect(conversation.agentResponses).toEqual([completed.response]);
  });

  it("refuses a new thread at the limit, starts no agent, and frees the thread", async () => {
    await seedActiveSession("other-1", 5);
    await seedActiveSession("other-2", 30);

    await send("event-1");

    expect(agent.invokeInputs).toEqual([]);
    expect(conversation.messages).toEqual([
      expect.stringMatching(LIMIT_MESSAGE),
    ]);
    expect(conversation.messages[0]).toContain("about 30 minutes");
    expect(conversation.statuses).toEqual([]);
    expect(await store.get(THREAD_ID)).not.toHaveProperty(
      "inFlightEventId",
    );

    // Once the oldest session leaves the window, the same thread can start.
    clock = new Date(clock.getTime() + 31 * MINUTE);
    await send("event-2");

    expect(agent.invokeInputs).toHaveLength(1);
    expect(conversation.agentResponses).toEqual([completed.response]);
  });

  it("never limits a follow-up while the agent sandbox is still warm", async () => {
    await seedActiveSession("other-1", 5);
    await store.put({
      threadId: THREAD_ID,
      agentSessionId: "session-1",
      updatedAt: minutesAgo(9),
    });

    await send("event-1", {
      sessionLimit: { limit: 1, idleTtlMs: 10 * MINUTE },
    });

    expect(agent.invokeInputs).toEqual([
      {
        message: "List projects",
        actorId: ACTOR_ID,
        sessionId: "session-1",
      },
    ]);
    expect(conversation.messages).toEqual([]);
  });

  it("limits a follow-up after the idle TTL and leaves the thread looking idle", async () => {
    await seedActiveSession("other-1", 5);
    await seedActiveSession("other-2", 20);
    const idleSince = minutesAgo(15);
    await store.put({
      threadId: THREAD_ID,
      agentSessionId: "session-1",
      updatedAt: idleSince,
    });

    await send("event-1");

    expect(agent.invokeInputs).toEqual([]);
    expect(conversation.messages).toEqual([
      expect.stringMatching(LIMIT_MESSAGE),
    ]);
    const record = await store.get(THREAD_ID);
    expect(record).toMatchObject({ agentSessionId: "session-1" });
    expect(record?.updatedAt).toEqual(idleSince);
    expect(record).not.toHaveProperty("inFlightEventId");
  });

  it("counts a thread that is starting its agent as an active session", async () => {
    await store.put({
      threadId: "slack:C123:starting",
      inFlightEventId: "event-0",
      inFlightStartedAt: minutesAgo(1),
      updatedAt: minutesAgo(1),
    });

    await send("event-1", {
      sessionLimit: { limit: 1, idleTtlMs: 10 * MINUTE },
    });

    expect(agent.invokeInputs).toEqual([]);
    expect(conversation.messages).toEqual([
      expect.stringMatching(LIMIT_MESSAGE),
    ]);
  });

  it("does not count threads whose agent never ran", async () => {
    await store.put({
      threadId: "slack:C123:refused",
      updatedAt: minutesAgo(1),
    });

    await send("event-1", {
      sessionLimit: { limit: 1, idleTtlMs: 10 * MINUTE },
    });

    expect(agent.invokeInputs).toHaveLength(1);
  });

  it("checks health only for turns that reach the agent", async () => {
    const listActivity = vi.spyOn(store, "listRecentSessionActivity");

    await send("event-1");
    expect(listActivity).toHaveBeenCalledTimes(1);

    // A redelivered event is a duplicate.
    await send("event-1");
    // A turn already in flight makes the thread busy.
    await store.claimTurn("slack:C123:busy", "event-0", clock);
    await send("event-2", { threadId: "slack:C123:busy" });

    expect(listActivity).toHaveBeenCalledTimes(1);
    expect(agent.invokeInputs).toHaveLength(1);
  });

  it("does not read health when no limit is configured", async () => {
    const listActivity = vi.spyOn(store, "listRecentSessionActivity");
    const get = vi.spyOn(store, "get");

    await send("event-1", { sessionLimit: null });

    expect(listActivity).not.toHaveBeenCalled();
    // The only read is the one that publishes the result, not a pre-claim read.
    expect(get).toHaveBeenCalledTimes(1);
    expect(agent.invokeInputs).toHaveLength(1);
  });

  it("lets the message through when health cannot be measured", async () => {
    const failure = new Error("mongo unavailable");
    vi.spyOn(store, "listRecentSessionActivity").mockRejectedValueOnce(
      failure,
    );

    await send("event-1");

    expect(agent.invokeInputs).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Could not check the agent session limit",
      failure,
    );
  });

  it("judges whether the thread is idle from the state it claimed", async () => {
    await seedActiveSession("other-1", 5);
    const idleRecord = {
      threadId: THREAD_ID,
      agentSessionId: "session-idle",
      updatedAt: minutesAgo(15),
    };
    // Another message is restarting this idle thread, so its claim makes the
    // thread look active.
    await store.put({
      ...idleRecord,
      inFlightEventId: "event-0",
      inFlightStartedAt: clock,
      updatedAt: clock,
    });
    // That restart fails and puts the idle timestamp back just before this
    // message claims the thread.
    const claimTurn = store.claimTurn.bind(store);
    vi.spyOn(store, "claimTurn").mockImplementationOnce(async (...args) => {
      await store.put(idleRecord);
      return claimTurn(...args);
    });

    await send("event-1", {
      sessionLimit: { limit: 1, idleTtlMs: 10 * MINUTE },
    });

    expect(agent.invokeInputs).toEqual([]);
    expect(conversation.messages).toEqual([
      expect.stringMatching(LIMIT_MESSAGE),
    ]);
  });

  it("never starts more sessions than the limit when threads arrive together", async () => {
    await Promise.all(
      ["a", "b", "c", "d"].map((name) =>
        send(`event-${name}`, {
          threadId: `slack:C123:new-${name}`,
          sessionLimit: { limit: 2, idleTtlMs: 10 * MINUTE },
        }),
      ),
    );

    expect(agent.invokeInputs.length).toBeLessThanOrEqual(2);
    expect(
      conversation.messages.filter((message) =>
        typeof message === "string" && LIMIT_MESSAGE.test(message),
      ).length + agent.invokeInputs.length,
    ).toBe(4);
  });

  it("uses an app-supplied limit message", async () => {
    await seedActiveSession("other-1", 5);

    await send("event-1", {
      sessionLimit: { limit: 1, idleTtlMs: 10 * MINUTE },
      messages: {
        ...defaultAgentChatMessages,
        sessionLimitReached: (botName, retryAfterMs) =>
          `${botName} is full for ${retryAfterMs} ms.`,
      },
    });

    expect(conversation.messages).toEqual([
      `${BOT_NAME} is full for ${55 * MINUTE} ms.`,
    ]);
  });

  it("checks the limit again when retrying an idle session that failed to restart", async () => {
    const idleSince = minutesAgo(15);
    await store.put({
      threadId: THREAD_ID,
      agentSessionId: "session-idle",
      updatedAt: idleSince,
    });
    agent.invokeError = new AgenticApiError(
      "The agent did not become ready during startup.",
      { status: 500, code: "AGENT_STARTUP_FAILED", requestOutcome: "unknown" },
    );

    await send("event-1");

    expect(agent.invokeInputs).toHaveLength(1);
    await expect(store.get(THREAD_ID)).resolves.toMatchObject({
      agentSessionId: "session-idle",
      updatedAt: idleSince,
    });

    agent.invokeError = undefined;
    await seedActiveSession("other-1", 5);
    clock = new Date(clock.getTime() + MINUTE);
    conversation.messages = [];
    await send("event-2", {
      sessionLimit: { limit: 1, idleTtlMs: 10 * MINUTE },
    });

    expect(agent.invokeInputs).toHaveLength(1);
    expect(conversation.messages).toEqual([
      expect.stringMatching(LIMIT_MESSAGE),
    ]);
  });
});

describe("handleConversationMessage startup failures", () => {
  let agent: FakeAgentGateway;
  let conversation: FakeConversation;
  let store: MemoryThreadStore;

  beforeEach(() => {
    agent = new FakeAgentGateway();
    conversation = new FakeConversation();
    store = new MemoryThreadStore();
  });

  function send(): Promise<void> {
    return handleConversationMessage(
      {
        threadId: THREAD_ID,
        eventId: "event-1",
        actorId: ACTOR_ID,
        text: "List projects",
      },
      {
        agent,
        botName: BOT_NAME,
        conversation,
        logger: { error: vi.fn(), warn: vi.fn() },
        store,
      },
    );
  }

  it("posts the generic message when the agent cannot start", async () => {
    agent.invokeError = new AgenticApiError(
      "The agent did not become ready during startup.",
      { status: 500, code: "AGENT_STARTUP_FAILED", requestOutcome: "unknown" },
    );

    await send();

    expect(conversation.messages).toEqual([
      `${BOT_NAME} could not complete that request. Please try again in a moment.`,
    ]);
    expect(await store.get(THREAD_ID)).not.toHaveProperty(
      "inFlightEventId",
    );
  });

  it("keeps the generic message for other failures", async () => {
    agent.invokeError = new Error("socket hang up");

    await send();

    expect(conversation.messages).toEqual([
      `${BOT_NAME} could not complete that request. Please try again in a moment.`,
    ]);
  });
});
