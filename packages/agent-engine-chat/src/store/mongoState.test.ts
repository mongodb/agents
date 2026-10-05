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

import { createSlackAdapter } from "@chat-adapter/slack";
import {
  Chat,
  Message,
  parseMarkdown,
  type QueueEntry,
} from "chat";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createMongoState,
  MongoStateAdapter,
} from "./mongoState.js";

const DATABASE_NAME = "chat_sdk_state_tests";

describe("MongoStateAdapter", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let database: Db;
  let state: MongoStateAdapter;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db(DATABASE_NAME);
  }, 120_000);

  beforeEach(async () => {
    await database.dropDatabase();
    state = createMongoState({ client, databaseName: DATABASE_NAME });
    await state.connect();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("creates one TTL index and can connect repeatedly", async () => {
    await state.connect();

    const indexes = await database
      .collection("chat_sdk_state")
      .listIndexes()
      .toArray();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { expiresAt: 1 },
          name: "chat_sdk_state_ttl",
          expireAfterSeconds: 0,
        }),
      ]),
    );
  });

  it("uses MONGODB_URI when constructed without an explicit URI", async () => {
    const previousUri = process.env.MONGODB_URI;
    process.env.MONGODB_URI = server.getUri();
    const environmentState = createMongoState({
      databaseName: "environment_state_test",
    });
    try {
      await environmentState.connect();
      await environmentState.set("source", "environment");

      await expect(environmentState.get("source")).resolves.toBe(
        "environment",
      );
    } finally {
      await environmentState.disconnect();
      if (previousUri === undefined) {
        delete process.env.MONGODB_URI;
      } else {
        process.env.MONGODB_URI = previousUri;
      }
    }
  });

  it("round-trips and deletes JSON cache values", async () => {
    await state.set("object", {
      count: 2,
      nested: ["one", "two"],
    });
    await state.set("string", "plain text");

    expect(await state.get("object")).toEqual({
      count: 2,
      nested: ["one", "two"],
    });
    expect(await state.get("string")).toBe("plain text");

    await state.delete("object");
    expect(await state.get("object")).toBeNull();
  });

  it("treats logically expired cache documents as absent before TTL cleanup", async () => {
    await state.set("short-lived", "old", 10);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await state.get("short-lived")).toBeNull();
    expect(
      await state.setIfNotExists("short-lived", "replacement", 1_000),
    ).toBe(true);
    expect(await state.get("short-lived")).toBe("replacement");
  });

  it("derives relative expirations from the MongoDB server clock", async () => {
    const hello = (await database.command({ hello: 1 })) as {
      localTime: Date;
    };
    const serverTime = hello.localTime.getTime();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
    try {
      await state.set("server-clock", "value", 60_000);
      await expect(state.get("server-clock")).resolves.toBe("value");
      await expect(
        state.setIfNotExists(
          "server-clock",
          "incorrect replacement",
        ),
      ).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }

    const stored = await database
      .collection<{ _id: string; expiresAt?: Date }>(
        "chat_sdk_state",
      )
      .findOne({ _id: "chat-sdk:cache:server-clock" });

    expect(stored?.expiresAt?.getTime()).toBeGreaterThanOrEqual(
      serverTime + 59_000,
    );
    expect(stored?.expiresAt?.getTime()).toBeLessThan(
      serverTime + 65_000,
    );
  });

  it("uses the MongoDB server clock for lock validity", async () => {
    const lock = await state.acquireLock("server-clock-lock", 60_000);
    expect(lock).not.toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
    try {
      await expect(state.extendLock(lock!, 60_000)).resolves.toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows only one concurrent first writer", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        state.setIfNotExists("winner", index),
      ),
    );

    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(await state.get<number>("winner")).toBe(
      attempts.findIndex(Boolean),
    );
  });

  it("persists thread subscriptions", async () => {
    expect(await state.isSubscribed("slack:C123:1")).toBe(false);

    await state.subscribe("slack:C123:1");
    expect(await state.isSubscribed("slack:C123:1")).toBe(true);

    await state.unsubscribe("slack:C123:1");
    expect(await state.isSubscribed("slack:C123:1")).toBe(false);
  });

  it("materializes subscriptions for legacy bot-owned Slack threads", async () => {
    const legacy = database.collection<{
      _id: string;
      recentSlackEventIds?: string[];
    }>("slack_threads");
    await legacy.insertOne({ _id: "C123:1" });

    expect(await state.isSubscribed("slack:C123:1")).toBe(true);

    await legacy.deleteOne({ _id: "C123:1" });
    expect(await state.isSubscribed("slack:C123:1")).toBe(true);
  });

  it("does not rematerialize a legacy subscription after unsubscribe", async () => {
    await database
      .collection<{ _id: string }>("slack_threads")
      .insertOne({ _id: "C123:1" });

    await Promise.all([
      state.isSubscribed("slack:C123:1"),
      state.unsubscribe("slack:C123:1"),
    ]);

    expect(await state.isSubscribed("slack:C123:1")).toBe(false);
    await state.subscribe("slack:C123:1");
    expect(await state.isSubscribed("slack:C123:1")).toBe(true);
    await state.unsubscribe("slack:C123:1");
    expect(await state.isSubscribed("slack:C123:1")).toBe(false);
  });

  it("recognizes legacy Slack envelope IDs during retry deduplication", async () => {
    const legacy = database.collection<{
      _id: string;
      recentSlackEventIds?: string[];
    }>("slack_threads");
    await legacy.insertOne({
      _id: "C123:1",
      recentSlackEventIds: ["Ev123"],
    });

    const before = Date.now();
    expect(
      await state.get("slack:event-delivered:Ev123"),
    ).toBe(true);
    const marker = await database
      .collection<{
        _id: string;
        expiresAt?: Date;
      }>("chat_sdk_state")
      .findOne({
        _id: "chat-sdk:cache:slack:event-delivered:Ev123",
      });
    expect(marker?.expiresAt?.getTime()).toBeGreaterThanOrEqual(
      before + 24 * 60 * 60 * 1_000,
    );

    await legacy.deleteOne({ _id: "C123:1" });
    expect(
      await state.get("slack:event-delivered:Ev123"),
    ).toBe(true);
  });

  it("suppresses official Slack adapter retries recorded before cutover", async () => {
    await database
      .collection<{
        _id: string;
        recentSlackEventIds?: string[];
      }>("slack_threads")
      .insertOne({
        _id: "C123:1",
        recentSlackEventIds: ["Ev123"],
      });
    const slack = createSlackAdapter({
      botToken: "xoxb-test",
      botUserId: "B123",
      mode: "webhook",
      webhookVerifier: () => true,
    });
    const bot = new Chat({
      adapters: { slack },
      logger: "silent",
      state,
      userName: "AtlasExplorer",
    });
    const mention = vi.fn();
    bot.onNewMention(mention);

    const response = await bot.webhooks.slack(
      new Request("https://example.com/api/webhooks/slack", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-retry-num": "1",
        },
        body: JSON.stringify({
          type: "event_callback",
          event_id: "Ev123",
          team_id: "T123",
          event: {
            type: "app_mention",
            channel: "C123",
            ts: "1",
            user: "U123",
            text: "<@B123> list projects",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mention).not.toHaveBeenCalled();
    await bot.shutdown();
  });

  it("supports lock contention, renewal, expiry takeover, and stale-token rejection", async () => {
    const first = await state.acquireLock("slack:C123:1", 25);
    expect(first).not.toBeNull();
    expect(await state.acquireLock("slack:C123:1", 1_000)).toBeNull();

    expect(
      await state.extendLock(
        { ...first!, token: "not-the-owner" },
        1_000,
      ),
    ).toBe(false);
    expect(await state.extendLock(first!, 75)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 90));
    const second = await state.acquireLock("slack:C123:1", 1_000);
    expect(second).not.toBeNull();
    expect(second?.token).not.toBe(first?.token);

    await state.releaseLock(first!);
    expect(await state.acquireLock("slack:C123:1", 1_000)).toBeNull();

    await state.releaseLock(second!);
    expect(await state.acquireLock("slack:C123:1", 1_000)).not.toBeNull();
  });

  it("force releases a lock regardless of its token", async () => {
    expect(await state.acquireLock("thread", 1_000)).not.toBeNull();

    await state.forceReleaseLock("thread");

    expect(await state.acquireLock("thread", 1_000)).not.toBeNull();
  });

  it("keeps lists ordered, bounded, and refreshes their TTL", async () => {
    await state.appendToList("history", 1, {
      maxLength: 2,
      ttlMs: 60,
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
    await state.appendToList("history", 2, {
      maxLength: 2,
      ttlMs: 60,
    });
    await state.appendToList("history", 3, {
      maxLength: 2,
      ttlMs: 60,
    });

    expect(await state.getList("history")).toEqual([2, 3]);

    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(await state.getList("history")).toEqual([2, 3]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(await state.getList("history")).toEqual([]);
  });

  it("bounds queues atomically and dequeues FIFO", async () => {
    for (const id of ["one", "two", "three"]) {
      await state.enqueue("thread", queueEntry(id), 2);
    }

    expect(await state.queueDepth("thread")).toBe(2);
    expect((await state.dequeue("thread"))?.message.id).toBe("two");
    expect((await state.dequeue("thread"))?.message.id).toBe("three");
    expect(await state.dequeue("thread")).toBeNull();
    expect(await state.queueDepth("thread")).toBe(0);
  });

  it("discards expired queue entries from dequeue and depth", async () => {
    await state.enqueue(
      "thread",
      queueEntry("expired", Date.now() - 1),
      5,
    );
    await state.enqueue(
      "thread",
      queueEntry("fresh", Date.now() + 60_000),
      5,
    );

    expect(await state.queueDepth("thread")).toBe(1);
    expect((await state.dequeue("thread"))?.message.id).toBe("fresh");
    expect(await state.dequeue("thread")).toBeNull();
  });

  it("retains longer-lived entries when a newer queue entry expires first", async () => {
    await state.enqueue(
      "thread",
      queueEntry("long-lived", Date.now() + 120_000),
      5,
    );
    await state.enqueue(
      "thread",
      queueEntry("short-lived", Date.now() + 10),
      5,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await state.queueDepth("thread")).toBe(1);
    expect((await state.dequeue("thread"))?.message.id).toBe(
      "long-lived",
    );
  });

  it("retains no queue entries when maxSize is zero", async () => {
    expect(
      await state.enqueue(
        "thread",
        queueEntry("discarded", Date.now() + 60_000),
        0,
      ),
    ).toBe(0);
    expect(await state.queueDepth("thread")).toBe(0);
  });

  it("serializes queued messages through JSON like the Redis adapter", async () => {
    const message = new Message({
      id: "message-1",
      threadId: "slack:C123:1",
      text: "Hello",
      formatted: parseMarkdown("Hello"),
      raw: { ts: "1.1" },
      author: {
        userId: "U123",
        userName: "ada",
        fullName: "Ada Lovelace",
        isBot: false,
        isMe: false,
      },
      metadata: {
        dateSent: new Date("2026-01-01T00:00:00.000Z"),
        edited: false,
      },
      attachments: [],
    });
    const entry: QueueEntry = {
      enqueuedAt: 1,
      expiresAt: Date.now() + 60_000,
      message,
    };

    await state.enqueue("thread", entry, 5);

    expect(await state.dequeue("thread")).toEqual(
      JSON.parse(JSON.stringify(entry)),
    );
  });

  it("keeps concurrent queue updates bounded without losing atomicity", async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        state.enqueue("thread", queueEntry(String(index)), 5),
      ),
    );

    expect(await state.queueDepth("thread")).toBe(5);
    const ids = new Set<string>();
    while ((await state.queueDepth("thread")) > 0) {
      ids.add((await state.dequeue("thread"))!.message.id);
    }
    expect(ids).toHaveLength(5);
  });

  it("dequeues each fresh entry exactly once under concurrency", async () => {
    for (let index = 0; index < 20; index += 1) {
      await state.enqueue(
        "thread",
        queueEntry(String(index), Date.now() + 60_000),
        20,
      );
    }

    const entries = await Promise.all(
      Array.from({ length: 20 }, () => state.dequeue("thread")),
    );

    expect(
      new Set(entries.map((entry) => entry?.message.id)),
    ).toHaveLength(20);
    expect(await state.queueDepth("thread")).toBe(0);
  });

  it("does not close a shared MongoClient when disconnected", async () => {
    await state.disconnect();

    await expect(database.command({ ping: 1 })).resolves.toMatchObject({
      ok: 1,
    });
  });

  it("rejects operations until connected", async () => {
    const disconnected = createMongoState({
      client,
      databaseName: DATABASE_NAME,
    });

    await expect(disconnected.get("key")).rejects.toThrow(
      "MongoStateAdapter is not connected",
    );
  });

  it("serializes disconnect behind an in-progress connection", async () => {
    let releaseIndex!: () => void;
    const indexGate = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });
    const collection = {
      createIndex: vi.fn(() => indexGate),
    };
    const fakeClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      db: vi.fn(() => ({
        collection: vi.fn(() => collection),
      })),
    } as unknown as MongoClient;
    const racingState = createMongoState({
      client: fakeClient,
      databaseName: "lifecycle_race",
    });

    const connecting = racingState.connect();
    await vi.waitFor(() =>
      expect(collection.createIndex).toHaveBeenCalled(),
    );
    const disconnecting = racingState.disconnect();
    releaseIndex();
    await Promise.all([connecting, disconnecting]);

    await expect(racingState.get("key")).rejects.toThrow(
      "MongoStateAdapter is not connected",
    );
  });

  it("closes an owned client when index initialization fails", async () => {
    const databaseName = "owned_state_initialization_failure";
    await client
      .db(databaseName)
      .collection("chat_sdk_state")
      .createIndex(
        { incompatible: 1 },
        { name: "chat_sdk_state_ttl" },
      );
    const ownedState = createMongoState({
      uri: server.getUri(),
      databaseName,
    });
    const close = vi.spyOn(ownedState.getClient(), "close");

    await expect(ownedState.connect()).rejects.toThrow();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

function queueEntry(
  id: string,
  expiresAt = Date.now() + 60_000,
): QueueEntry {
  return {
    enqueuedAt: Date.now(),
    expiresAt,
    message: {
      id,
      threadId: "thread",
    } as QueueEntry["message"],
  };
}
