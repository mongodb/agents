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

import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { MongoThreadStore } from "./mongoThreadStore.js";
import {
  exercisesDeliveryCompletion,
  exercisesReviewClaim,
  exercisesRoundTrip,
  exercisesTurnClaim,
} from "./threadStore.test-helpers.js";

describe("MongoThreadStore", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let database: Db;
  let store: MongoThreadStore;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("thread_store_tests");
  }, 120_000);

  beforeEach(async () => {
    await database.dropDatabase();
    store = MongoThreadStore.fromDatabase(database);
    await store.initialize();
  });

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  it("round-trips a chat-to-Agent Engine record", async () => {
    await exercisesRoundTrip(store);
  });

  it("creates neutral unique and retention indexes", async () => {
    const indexes = await database
      .collection("chat_threads")
      .listIndexes()
      .toArray();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { threadId: 1 },
          name: "chat_thread_unique",
          unique: true,
        }),
        expect.objectContaining({
          key: { updatedAt: 1 },
          name: "inactive_thread_ttl",
          expireAfterSeconds: 2_592_000,
        }),
        expect.objectContaining({
          key: { updatedAt: 1 },
          name: "pending_delivery_ttl",
          expireAfterSeconds: 86_400,
        }),
      ]),
    );
  });

  it("atomically claims one reviewer for a pending interrupt", async () => {
    await exercisesReviewClaim(store);
  });

  it("deduplicates events and serializes turns", async () => {
    await exercisesTurnClaim(store);
  });

  it("conditionally completes pending delivery claims", async () => {
    await exercisesDeliveryCompletion(store);
  });

  it("lazily translates active Slack records during cutover", async () => {
    const updatedAt = new Date("2026-09-09T12:00:00.000Z");
    await database
      .collection<{ _id: string; [key: string]: unknown }>(
        "slack_threads",
      )
      .insertOne({
        _id: "C123:1720000000.000100",
        channelId: "C123",
        threadTs: "1720000000.000100",
        agentSessionId: "session-1",
        pendingInterruptId: "interrupt-1",
        pendingInterrupts: [
          {
            id: "interrupt-1",
            value: {
              actionRequests: [
                {
                  name: "insert_document",
                  arguments: { collection: "orders" },
                },
              ],
              reviewConfigs: [],
            },
          },
        ],
        pendingRequestedBySlackUserId: "U123",
        pendingReviewState: "pending",
        pendingDelivery: {
          id: "delivery-1",
          text: "Recovered response",
          state: "pending",
        },
        recentSlackEventIds: ["event-1"],
        updatedAt,
      });

    const migrated = await store.claimPendingReview(
      "slack:C123:1720000000.000100",
      "interrupt-1",
      new Date("2026-09-09T12:01:00.000Z"),
    );

    expect(migrated).toMatchObject({
      threadId: "slack:C123:1720000000.000100",
      agentSessionId: "session-1",
      pendingInterruptId: "interrupt-1",
      pendingRequestedByActorId: "slack:U123",
      pendingReviewState: "resuming",
      pendingDelivery: {
        id: "delivery-1",
        text: "Recovered response",
      },
      recentEventIds: ["slack:event-1"],
    });
    expect(
      await database
        .collection<{ _id: string; [key: string]: unknown }>(
          "chat_threads",
        )
        .findOne({
          _id: "slack:C123:1720000000.000100",
        }),
    ).toMatchObject({
      threadId: "slack:C123:1720000000.000100",
      agentSessionId: "session-1",
    });
    expect(
      await database
        .collection<{ _id: string; [key: string]: unknown }>(
          "slack_threads",
        )
        .findOne({ _id: "C123:1720000000.000100" }),
    ).toMatchObject({
      chatSdkMigrationState: "complete",
      chatSdkThreadId: "slack:C123:1720000000.000100",
    });

    await database
      .collection<{ _id: string }>("chat_threads")
      .deleteOne({ _id: "slack:C123:1720000000.000100" });

    await expect(
      store.get("slack:C123:1720000000.000100"),
    ).resolves.toBeNull();
  });

  it("does not close a shared client", async () => {
    await store.close();

    await expect(database.command({ ping: 1 })).resolves.toMatchObject({
      ok: 1,
    });
  });
});
