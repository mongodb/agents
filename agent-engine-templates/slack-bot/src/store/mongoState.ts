import { randomUUID } from "node:crypto";

import type { Lock, QueueEntry, StateAdapter } from "chat";
import {
  type Collection,
  type Document,
  MongoClient,
} from "mongodb";

const DEFAULT_COLLECTION_NAME = "chat_sdk_state";
const DEFAULT_DATABASE_NAME = "atlas_explorer";
const DEFAULT_KEY_PREFIX = "chat-sdk";
const DEFAULT_LEGACY_THREAD_COLLECTION_NAME = "slack_threads";
const LEGACY_EVENT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1_000;
const QUEUE_DOCUMENT_MIN_TTL_MS = 60_000;

type StateKind =
  | "subscription"
  | "subscription_tombstone"
  | "lock"
  | "cache"
  | "list"
  | "queue";

interface MongoStateDocument {
  _id: string;
  dequeuedQueueValue?: MongoQueueValue;
  expiresAt?: Date;
  kind: StateKind;
  queueDepthValue?: number;
  queueValues?: MongoQueueValue[];
  token?: string;
  value?: string;
  values?: string[];
}

interface MongoQueueValue {
  expiresAt: Date;
  value: string;
}

interface LegacySlackStateSource {
  _id: string;
  recentSlackEventIds?: string[];
}

interface MongoStateBaseOptions {
  collectionName?: string;
  databaseName?: string;
  keyPrefix?: string;
  legacyThreadCollectionName?: string;
}

export type MongoStateOptions = MongoStateBaseOptions &
  (
    | {
        client: MongoClient;
        uri?: never;
      }
    | {
        client?: never;
        uri?: string;
      }
  );

/**
 * Chat SDK state backed by one namespaced MongoDB collection.
 *
 * A supplied client is shared and is never closed by this adapter. When the
 * adapter creates its own client from a URI, disconnect() owns its lifecycle.
 */
export class MongoStateAdapter implements StateAdapter {
  private readonly client: MongoClient;
  private readonly collection: Collection<MongoStateDocument>;
  private readonly keyPrefix: string;
  private readonly legacyThreads: Collection<LegacySlackStateSource>;
  private readonly ownsClient: boolean;
  private connected = false;
  private lifecycle: Promise<void> = Promise.resolve();

  constructor(options: MongoStateOptions) {
    const uri = options.uri ?? process.env.MONGODB_URI;
    if ("client" in options && options.client) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      if (!uri) {
        throw new Error(
          "MongoDB URI is required. Set MONGODB_URI or provide uri.",
        );
      }
      this.client = new MongoClient(uri);
      this.ownsClient = true;
    }

    const databaseName =
      options.databaseName ??
      process.env.MONGODB_DATABASE ??
      DEFAULT_DATABASE_NAME;
    const database = this.client.db(databaseName);
    this.collection = database.collection<MongoStateDocument>(
        options.collectionName ?? DEFAULT_COLLECTION_NAME,
      );
    this.legacyThreads =
      database.collection<LegacySlackStateSource>(
        options.legacyThreadCollectionName ??
          DEFAULT_LEGACY_THREAD_COLLECTION_NAME,
      );
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  }

  connect(): Promise<void> {
    const operation = this.lifecycle.then(async () => {
      if (this.connected) {
        return;
      }
      try {
        await this.initialize();
      } catch (error) {
        this.connected = false;
        if (this.ownsClient) {
          await this.client.close().catch(() => undefined);
        }
        throw error;
      }
    });
    this.lifecycle = operation.catch(() => undefined);
    return operation;
  }

  disconnect(): Promise<void> {
    const operation = this.lifecycle.then(async () => {
      try {
        if (this.ownsClient) {
          await this.client.close();
        }
      } finally {
        this.connected = false;
      }
    });
    this.lifecycle = operation.catch(() => undefined);
    return operation;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();
    const document = await this.findActive(this.key("cache", key));
    if (!document?.value) {
      const legacyEventId = legacySlackEventId(key);
      if (
        !legacyEventId ||
        !(await this.legacyThreads.findOne({
          recentSlackEventIds: legacyEventId,
        }))
      ) {
        return null;
      }
      await this.set(key, true, LEGACY_EVENT_DEDUPE_TTL_MS);
      return true as T;
    }
    return deserialize<T>(document.value);
  }

  async set<T = unknown>(
    key: string,
    value: T,
    ttlMs?: number,
  ): Promise<void> {
    this.ensureConnected();
    const update = valueUpdate("cache", serialize(value), ttlMs);
    await this.collection.updateOne(
      { _id: this.key("cache", key) },
      update,
      { upsert: true },
    );
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();
    await this.collection.deleteOne({
      _id: this.key("cache", key),
    });
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<boolean> {
    this.ensureConnected();
    const id = this.key("cache", key);
    const update = valueUpdate(
      "cache",
      serialize(value),
      ttlMs,
    );
    const replaced = await this.collection.updateOne(
      {
        _id: id,
        $expr: expiredExpression(),
      },
      update,
    );
    if (replaced.matchedCount === 1) {
      return true;
    }
    try {
      const inserted = await this.collection.updateOne(
        {
          _id: id,
          kind: { $exists: false },
        },
        update,
        { upsert: true },
      );
      return (
        inserted.upsertedCount === 1 ||
        inserted.matchedCount === 1
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return false;
      }
      throw error;
    }
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.collection.updateOne(
      { _id: this.key("subscription", threadId) },
      {
        $set: { kind: "subscription" },
        $unset: { expiresAt: "", token: "", value: "", values: "" },
      },
      { upsert: true },
    );
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.collection.updateOne(
      { _id: this.key("subscription", threadId) },
      {
        $set: { kind: "subscription_tombstone" },
        $unset: { expiresAt: "", token: "", value: "", values: "" },
      },
      { upsert: true },
    );
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const id = this.key("subscription", threadId);
    const existing = await this.collection.findOne({ _id: id });
    if (existing) {
      return existing.kind === "subscription";
    }
    const legacyKey = legacySlackThreadKey(threadId);
    if (!legacyKey) {
      return false;
    }
    const legacy = await this.legacyThreads.findOne({
      _id: legacyKey,
    });
    if (!legacy) {
      return false;
    }
    try {
      await this.collection.updateOne(
        { _id: id },
        {
          $setOnInsert: { kind: "subscription" },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
    return (
      (await this.collection.findOne({ _id: id }))?.kind ===
      "subscription"
    );
  }

  async acquireLock(
    threadId: string,
    ttlMs: number,
  ): Promise<Lock | null> {
    this.ensureConnected();
    const id = this.key("lock", threadId);
    const token = `mongo_${randomUUID()}`;
    const update = lockUpdate(token, ttlMs);
    try {
      let document = await this.collection.findOneAndUpdate(
        {
          _id: id,
          $expr: expiredExpression(),
        },
        update,
        { returnDocument: "after" },
      );
      document ??= await this.collection.findOneAndUpdate(
        {
          _id: id,
          kind: { $exists: false },
        },
        update,
        { upsert: true, returnDocument: "after" },
      );
      if (!document?.expiresAt) {
        throw new Error("MongoDB did not return the acquired lock");
      }
      return {
        threadId,
        token,
        expiresAt: document.expiresAt.getTime(),
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return null;
      }
      throw error;
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();
    const result = await this.collection.updateOne(
      {
        _id: this.key("lock", lock.threadId),
        token: lock.token,
        $expr: activeExpression(),
      },
      [
        {
          $set: {
            expiresAt: serverExpiration(ttlMs),
          },
        },
      ],
    );
    return result.matchedCount === 1;
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();
    await this.collection.deleteOne({
      _id: this.key("lock", lock.threadId),
      token: lock.token,
    });
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.collection.deleteOne({
      _id: this.key("lock", threadId),
    });
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number,
  ): Promise<number> {
    this.ensureConnected();
    const entryExpiresAt = new Date(entry.expiresAt);
    const minimumDocumentExpiry = serverExpiration(
      QUEUE_DOCUMENT_MIN_TTL_MS,
    );
    const queueValues = appendQueuePipelineValue(
      {
        expiresAt: entryExpiresAt,
        value: serialize(entry),
      },
      maxSize,
    );
    const document = await this.collection.findOneAndUpdate(
      { _id: this.key("queue", threadId) },
      [
        {
          $set: {
            kind: "queue",
            queueValues,
            queueDepthValue: { $size: queueValues },
            dequeuedQueueValue: "$$REMOVE",
            expiresAt: {
              $max: [
                {
                  $ifNull: [
                    "$expiresAt",
                    minimumDocumentExpiry,
                  ],
                },
                entryExpiresAt,
                minimumDocumentExpiry,
              ],
            },
            token: "$$REMOVE",
            value: "$$REMOVE",
            values: "$$REMOVE",
          },
        },
      ],
      {
        upsert: true,
        returnDocument: "after",
      },
    );
    const depth = document?.queueValues?.length ?? 0;
    if (depth === 0) {
      await this.deleteEmptyQueue(this.key("queue", threadId));
    }
    return depth;
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();
    const id = this.key("queue", threadId);
    const activeValues = activeQueueValues();
    const document = await this.collection.findOneAndUpdate(
      {
        _id: id,
        kind: "queue",
      },
      [
        {
          $set: {
            dequeuedQueueValue:
              firstActiveQueueValue(activeValues),
            queueValues: remainingQueueValues(activeValues),
            queueDepthValue:
              remainingQueueDepth(activeValues),
          },
        },
      ],
      { returnDocument: "after" },
    );
    const queued = document?.dequeuedQueueValue;
    if ((document?.queueDepthValue ?? 0) === 0) {
      await this.deleteEmptyQueue(id);
    }
    return queued ? deserialize<QueueEntry>(queued.value) : null;
  }

  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();
    const id = this.key("queue", threadId);
    const activeValues = activeQueueValues();
    const document = await this.collection.findOneAndUpdate(
      {
        _id: id,
        kind: "queue",
      },
      [
        {
          $set: {
            dequeuedQueueValue: "$$REMOVE",
            queueDepthValue: { $size: activeValues },
            queueValues: activeValues,
          },
        },
      ],
      { returnDocument: "after" },
    );
    const depth = document?.queueDepthValue ?? 0;
    if (depth === 0) {
      await this.deleteEmptyQueue(id);
    }
    return depth;
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: {
      maxLength?: number;
      ttlMs?: number;
    },
  ): Promise<void> {
    this.ensureConnected();
    const expiresAt = options?.ttlMs
      ? serverExpiration(options.ttlMs)
      : "$$REMOVE";
    await this.collection.updateOne(
      { _id: this.key("list", key) },
      [
        {
          $set: {
            kind: "list",
            values: appendPipelineValues(
              serialize(value),
              options?.maxLength ?? 0,
            ),
            expiresAt,
          },
        },
      ],
      { upsert: true },
    );
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();
    const document = await this.findActive(this.key("list", key));
    return (document?.values ?? []).map((value) =>
      deserialize<T>(value),
    );
  }

  getClient(): MongoClient {
    return this.client;
  }

  private async initialize(): Promise<void> {
    await this.client.connect();
    await this.collection.createIndex(
      { expiresAt: 1 },
      {
        name: "chat_sdk_state_ttl",
        expireAfterSeconds: 0,
      },
    );
    this.connected = true;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "MongoStateAdapter is not connected. Call connect() first.",
      );
    }
  }

  private key(kind: StateKind, id: string): string {
    return `${this.keyPrefix}:${kind}:${id}`;
  }

  private async findActive(
    id: string,
  ): Promise<MongoStateDocument | null> {
    const document = await this.collection.findOne({
      _id: id,
      $or: [
        { expiresAt: { $exists: false } },
        { $expr: activeExpression() },
      ],
    });
    if (!document) {
      await this.deleteIfExpired(id);
    }
    return document;
  }

  private async deleteIfExpired(
    id: string,
  ): Promise<void> {
    await this.collection.deleteOne({
      _id: id,
      $expr: expiredExpression(),
    });
  }

  private async deleteEmptyQueue(id: string): Promise<void> {
    await this.collection.deleteOne({
      _id: id,
      kind: "queue",
      "queueValues.0": { $exists: false },
    });
  }
}

export function createMongoState(
  options: MongoStateOptions = {},
): MongoStateAdapter {
  return new MongoStateAdapter(options);
}

function valueUpdate(
  kind: "cache",
  value: string,
  ttlMs?: number,
): Document[] {
  return [
    {
      $set: {
        kind,
        value,
        expiresAt: ttlMs
          ? serverExpiration(ttlMs)
          : "$$REMOVE",
        queueValues: "$$REMOVE",
        token: "$$REMOVE",
        values: "$$REMOVE",
      },
    },
  ];
}

function lockUpdate(token: string, ttlMs: number): Document[] {
  return [
    {
      $set: {
        kind: "lock",
        token,
        expiresAt: serverExpiration(ttlMs),
        queueValues: "$$REMOVE",
        value: "$$REMOVE",
        values: "$$REMOVE",
      },
    },
  ];
}

function serverExpiration(ttlMs: number): Document {
  return {
    $dateAdd: {
      startDate: "$$NOW",
      unit: "millisecond",
      amount: ttlMs,
    },
  };
}

function activeExpression(): Document {
  return { $gt: ["$expiresAt", "$$NOW"] };
}

function expiredExpression(): Document {
  return {
    $and: [
      { $eq: [{ $type: "$expiresAt" }, "date"] },
      { $lte: ["$expiresAt", "$$NOW"] },
    ],
  };
}

function activeQueueValues(): Document {
  return {
    $filter: {
      input: { $ifNull: ["$queueValues", []] },
      as: "queued",
      cond: { $gt: ["$$queued.expiresAt", "$$NOW"] },
    },
  };
}

function firstActiveQueueValue(
  activeValues: Document,
): Document {
  return {
    $cond: [
      { $gt: [{ $size: activeValues }, 0] },
      { $arrayElemAt: [activeValues, 0] },
      "$$REMOVE",
    ],
  };
}

function remainingQueueValues(
  activeValues: Document,
): Document {
  return {
    $slice: [
      activeValues,
      1,
      { $size: activeValues },
    ],
  };
}

function remainingQueueDepth(
  activeValues: Document,
): Document {
  return {
    $max: [
      { $subtract: [{ $size: activeValues }, 1] },
      0,
    ],
  };
}

function appendQueuePipelineValue(
  queued: MongoQueueValue,
  maxSize: number,
): Document {
  if (maxSize <= 0) {
    return { $literal: [] };
  }
  const appended: Document = {
    $concatArrays: [
      activeQueueValues(),
      {
        $cond: [
          { $gt: [queued.expiresAt, "$$NOW"] },
          [queued],
          [],
        ],
      },
    ],
  };
  return { $slice: [appended, -maxSize] };
}

function appendPipelineValues(
  serialized: string,
  maxLength: number,
): Document {
  const activeValues: Document = {
    $cond: [
      {
        $or: [
          { $eq: [{ $type: "$expiresAt" }, "missing"] },
          { $gt: ["$expiresAt", "$$NOW"] },
        ],
      },
      { $ifNull: ["$values", []] },
      [],
    ],
  };
  const appended: Document = {
    $concatArrays: [activeValues, [serialized]],
  };
  return maxLength > 0
    ? { $slice: [appended, -maxLength] }
    : appended;
}

function serialize(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("MongoStateAdapter cannot serialize undefined");
  }
  return serialized;
}

function deserialize<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

function legacySlackThreadKey(threadId: string): string | null {
  const match = /^slack:([^:]+):([^:]+)$/.exec(threadId);
  return match ? `${match[1]}:${match[2]}` : null;
}

function legacySlackEventId(key: string): string | null {
  const prefix = "slack:event-delivered:";
  return key.startsWith(prefix) ? key.slice(prefix.length) || null : null;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
