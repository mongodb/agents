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
  type Collection,
  type Db,
  MongoClient,
} from "mongodb";

import type {
  ThreadRecord,
  ThreadStore,
  TurnClaim,
} from "./threadStore.js";
import { threadKey } from "./threadStore.js";

interface StoredThreadRecord extends ThreadRecord {
  _id: string;
}

type LegacyStoredThreadRecord = Omit<
  ThreadRecord,
  "pendingRequestedByActorId" | "recentEventIds" | "threadId"
> & {
  _id: string;
  channelId: string;
  chatSdkMigratedAt?: Date;
  chatSdkMigrationState?: "copying" | "complete";
  chatSdkThreadId?: string;
  pendingRequestedBySlackUserId?: string;
  recentSlackEventIds?: string[];
  threadTs: string;
};

interface MongoThreadStoreOptions {
  client?: MongoClient;
  initializeOnAccess?: boolean;
  legacyCollection?: Collection<LegacyStoredThreadRecord>;
}

const TURN_LEASE_MS = 10 * 60 * 1_000;
const DELIVERY_LEASE_MS = 5 * 60 * 1_000;
const RECENT_EVENT_LIMIT = 20;
const COLLECTION_NAME = "chat_threads";
const LEGACY_COLLECTION_NAME = "slack_threads";

export class MongoThreadStore implements ThreadStore {
  private readonly collection: Collection<StoredThreadRecord>;
  private readonly client?: MongoClient;
  private readonly initializeOnAccess: boolean;
  private readonly legacyCollection?: Collection<LegacyStoredThreadRecord>;
  private initialization?: Promise<void>;

  constructor(
    collection: Collection<StoredThreadRecord>,
    options: MongoThreadStoreOptions = {},
  ) {
    this.collection = collection;
    this.client = options.client;
    this.initializeOnAccess = options.initializeOnAccess ?? false;
    this.legacyCollection = options.legacyCollection;
  }

  static fromDatabase(
    database: Db,
    options: MongoThreadStoreOptions = {},
  ): MongoThreadStore {
    return new MongoThreadStore(
      database.collection<StoredThreadRecord>(COLLECTION_NAME),
      {
        ...options,
        legacyCollection:
          options.legacyCollection ??
          database.collection<LegacyStoredThreadRecord>(
            LEGACY_COLLECTION_NAME,
          ),
      },
    );
  }

  static async connect(
    uri: string,
    databaseName: string,
  ): Promise<MongoThreadStore> {
    const client = new MongoClient(uri);
    try {
      await client.connect();
      const store = MongoThreadStore.fromDatabase(
        client.db(databaseName),
        { client },
      );
      await store.initialize();
      return store;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async initialize(): Promise<void> {
    await this.collection.createIndex(
      { threadId: 1 },
      {
        name: "chat_thread_unique",
        unique: true,
      },
    );
    await this.collection.createIndex(
      { updatedAt: 1 },
      {
        name: "inactive_thread_ttl",
        expireAfterSeconds: 30 * 24 * 60 * 60,
        partialFilterExpression: {
          retentionState: "inactive",
        },
      },
    );
    await this.collection.createIndex(
      { updatedAt: 1 },
      {
        name: "pending_delivery_ttl",
        expireAfterSeconds: 24 * 60 * 60,
        partialFilterExpression: {
          retentionState: "delivery_pending",
        },
      },
    );
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    await this.ensureInitialized();
    const document = await this.findOrMigrate(threadId);
    return document ? withoutId(document) : null;
  }

  async put(record: ThreadRecord): Promise<void> {
    await this.ensureInitialized();
    const document = withId(record);
    await this.collection.replaceOne(
      { _id: document._id },
      document,
      { upsert: true },
    );
  }

  async claimTurn(
    threadId: string,
    eventId: string,
    claimedAt: Date,
  ): Promise<TurnClaim> {
    await this.ensureInitialized();
    const key = threadKey(threadId);
    const staleBefore = new Date(
      claimedAt.getTime() - TURN_LEASE_MS,
    );
    await this.findOrMigrate(threadId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.collection.findOne({ _id: key });
      if (!existing) {
        const inserted: StoredThreadRecord = {
          _id: key,
          threadId,
          recentEventIds: [eventId],
          inFlightEventId: eventId,
          inFlightStartedAt: claimedAt,
          updatedAt: claimedAt,
        };
        try {
          await this.collection.insertOne(inserted);
          return {
            status: "claimed",
            record: withoutId(inserted),
          };
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            continue;
          }
          throw error;
        }
      }

      const status = turnConflictStatus(
        existing,
        eventId,
        staleBefore,
      );
      if (status) {
        return { status, record: withoutId(existing) };
      }

      const updated = await this.collection.findOneAndUpdate(
        {
          _id: key,
          recentEventIds: { $ne: eventId },
          $and: [
            {
              $or: [
                { pendingInterruptId: { $exists: false } },
              ],
            },
            {
              $or: [
                { inFlightEventId: { $exists: false } },
                { inFlightStartedAt: { $lt: staleBefore } },
              ],
            },
          ],
        },
        {
          $set: {
            inFlightEventId: eventId,
            inFlightStartedAt: claimedAt,
            updatedAt: claimedAt,
          },
          $unset: { retentionState: "" },
          $push: {
            recentEventIds: {
              $each: [eventId],
              $slice: -RECENT_EVENT_LIMIT,
            },
          },
        },
        { returnDocument: "after" },
      );
      if (updated) {
        return { status: "claimed", record: withoutId(updated) };
      }
    }

    const current = await this.collection.findOne({ _id: key });
    if (!current) {
      throw new Error("Could not claim chat thread turn");
    }
    return {
      status:
        turnConflictStatus(current, eventId, staleBefore) ?? "busy",
      record: withoutId(current),
    };
  }

  async replaceClaimedTurn(
    eventId: string,
    record: ThreadRecord,
  ): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.collection.replaceOne(
      {
        _id: threadKey(record.threadId),
        inFlightEventId: eventId,
      },
      withId(record),
      { upsert: false },
    );
    return result.matchedCount === 1;
  }

  async claimPendingReview(
    threadId: string,
    interruptId: string,
    claimedAt: Date,
  ): Promise<ThreadRecord | null> {
    await this.ensureInitialized();
    await this.findOrMigrate(threadId);
    const document = await this.collection.findOneAndUpdate(
      {
        _id: threadKey(threadId),
        pendingInterruptId: interruptId,
        $or: [
          { pendingReviewState: { $exists: false } },
          { pendingReviewState: "pending" },
        ],
      },
      {
        $set: {
          pendingReviewState: "resuming",
          pendingReviewClaimedAt: claimedAt,
          updatedAt: claimedAt,
        },
      },
      { returnDocument: "after" },
    );
    return document ? withoutId(document) : null;
  }

  async replaceClaimedReview(
    interruptId: string,
    record: ThreadRecord,
  ): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.collection.replaceOne(
      {
        _id: threadKey(record.threadId),
        pendingInterruptId: interruptId,
        pendingReviewState: "resuming",
      },
      withId(record),
      { upsert: false },
    );
    return result.matchedCount === 1;
  }

  async clearPendingDelivery(
    threadId: string,
    deliveryId: string,
    claimId: string,
  ): Promise<boolean> {
    await this.ensureInitialized();
    await this.findOrMigrate(threadId);
    const document = await this.collection.findOneAndUpdate(
      {
        _id: threadKey(threadId),
        "pendingDelivery.id": deliveryId,
        "pendingDelivery.claimId": claimId,
      },
      {
        $set: { retentionState: "inactive" },
        $unset: { pendingDelivery: "" },
      },
      { returnDocument: "after" },
    );
    return document !== null;
  }

  async claimPendingDelivery(
    threadId: string,
    deliveryId: string,
    claimId: string,
    claimedAt: Date,
  ) {
    await this.ensureInitialized();
    await this.findOrMigrate(threadId);
    const staleBefore = new Date(
      claimedAt.getTime() - DELIVERY_LEASE_MS,
    );
    const document = await this.collection.findOneAndUpdate(
      {
        _id: threadKey(threadId),
        "pendingDelivery.id": deliveryId,
        $or: [
          { "pendingDelivery.state": { $in: [null, "pending"] } },
          {
            "pendingDelivery.state": "sending",
            "pendingDelivery.claimedAt": { $lt: staleBefore },
          },
        ],
      },
      {
        $inc: { "pendingDelivery.attemptCount": 1 },
        $set: {
          "pendingDelivery.state": "sending",
          "pendingDelivery.claimId": claimId,
          "pendingDelivery.claimedAt": claimedAt,
        },
      },
      { returnDocument: "after" },
    );
    return document?.pendingDelivery ?? null;
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initializeOnAccess) {
      return;
    }
    this.initialization ??= this.initialize();
    await this.initialization;
  }

  private async findOrMigrate(
    threadId: string,
  ): Promise<StoredThreadRecord | null> {
    const key = threadKey(threadId);
    const current = await this.collection.findOne({ _id: key });
    const legacyKey = legacySlackThreadKey(threadId);
    if (current) {
      if (this.legacyCollection && legacyKey) {
        await this.completeLegacyMigration(legacyKey, threadId);
      }
      return current;
    }
    if (!this.legacyCollection || !legacyKey) {
      return null;
    }
    const legacy = await this.legacyCollection.findOneAndUpdate(
      {
        _id: legacyKey,
        chatSdkMigrationState: { $ne: "complete" },
      },
      {
        $set: {
          chatSdkMigrationState: "copying",
          chatSdkThreadId: threadId,
        },
      },
      { returnDocument: "after" },
    );
    if (!legacy) {
      return null;
    }

    const translated = withId(
      translateLegacyRecord(threadId, legacy),
    );
    try {
      await this.collection.insertOne(translated);
      await this.completeLegacyMigration(legacyKey, threadId);
      return translated;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const raced = await this.collection.findOne({ _id: key });
      if (raced) {
        await this.completeLegacyMigration(legacyKey, threadId);
      }
      return raced;
    }
  }

  private async completeLegacyMigration(
    legacyKey: string,
    threadId: string,
  ): Promise<void> {
    await this.legacyCollection?.updateOne(
      {
        _id: legacyKey,
        chatSdkMigrationState: { $ne: "complete" },
      },
      {
        $set: {
          chatSdkMigratedAt: new Date(),
          chatSdkMigrationState: "complete",
          chatSdkThreadId: threadId,
        },
      },
    );
  }
}

function turnConflictStatus(
  record: StoredThreadRecord,
  eventId: string,
  staleBefore: Date,
): Exclude<TurnClaim["status"], "claimed"> | null {
  if (record.recentEventIds?.includes(eventId)) {
    return "duplicate";
  }
  if (record.pendingInterruptId) {
    return "pending_review";
  }
  if (
    record.inFlightEventId &&
    record.inFlightStartedAt &&
    record.inFlightStartedAt > staleBefore
  ) {
    return "busy";
  }
  return null;
}

function withId(record: ThreadRecord): StoredThreadRecord {
  return Object.fromEntries(
    Object.entries({
      _id: threadKey(record.threadId),
      ...record,
    }).filter((entry) => entry[1] !== undefined),
  ) as unknown as StoredThreadRecord;
}

function withoutId(document: StoredThreadRecord): ThreadRecord {
  const { _id: _discarded, ...record } = document;
  return record;
}

function legacySlackThreadKey(threadId: string): string | null {
  const match = /^slack:([^:]+):([^:]+)$/.exec(threadId);
  return match ? `${match[1]}:${match[2]}` : null;
}

function translateLegacyRecord(
  threadId: string,
  legacy: LegacyStoredThreadRecord,
): ThreadRecord {
  const {
    _id: _discarded,
    channelId: _channelId,
    chatSdkMigratedAt: _chatSdkMigratedAt,
    chatSdkMigrationState: _chatSdkMigrationState,
    chatSdkThreadId: _chatSdkThreadId,
    threadTs: _threadTs,
    recentSlackEventIds,
    pendingRequestedBySlackUserId,
    ...shared
  } = legacy;
  return {
    ...shared,
    threadId,
    ...(recentSlackEventIds
      ? {
          recentEventIds: recentSlackEventIds.map((eventId) =>
            eventId.includes(":")
              ? eventId
              : `slack:${eventId}`,
          ),
        }
      : {}),
    ...(pendingRequestedBySlackUserId
      ? {
          pendingRequestedByActorId:
            pendingRequestedBySlackUserId.includes(":")
              ? pendingRequestedBySlackUserId
              : `slack:${pendingRequestedBySlackUserId}`,
        }
      : {}),
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
