import {
  threadKey,
  type ThreadRecord,
  type ThreadStore,
  type TurnClaim,
} from "./threadStore.js";

interface MemoryThreadStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 1_000;
const TURN_LEASE_MS = 10 * 60 * 1_000;
const DELIVERY_LEASE_MS = 5 * 60 * 1_000;
const RECENT_EVENT_LIMIT = 20;

export class MemoryThreadStore implements ThreadStore {
  private readonly records = new Map<string, ThreadRecord>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: MemoryThreadStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    const key = threadKey(threadId);
    const record = this.records.get(key);
    if (!record) {
      return null;
    }
    if (this.now() - record.updatedAt.getTime() > this.ttlMs) {
      this.records.delete(key);
      return null;
    }
    return structuredClone(record);
  }

  async put(record: ThreadRecord): Promise<void> {
    this.records.set(
      threadKey(record.threadId),
      structuredClone(record),
    );
    this.removeExpiredRecords();
    this.evictOldestRecords();
  }

  async claimTurn(
    threadId: string,
    eventId: string,
    claimedAt: Date,
  ): Promise<TurnClaim> {
    const key = threadKey(threadId);
    const existing = this.records.get(key);
    if (existing?.recentEventIds?.includes(eventId)) {
      return {
        status: "duplicate",
        record: structuredClone(existing),
      };
    }
    if (existing?.pendingInterruptId) {
      return {
        status: "pending_review",
        record: structuredClone(existing),
      };
    }
    if (
      existing?.inFlightEventId &&
      existing.inFlightStartedAt &&
      claimedAt.getTime() - existing.inFlightStartedAt.getTime() <
        TURN_LEASE_MS
    ) {
      return {
        status: "busy",
        record: structuredClone(existing),
      };
    }

    const claimed: ThreadRecord = {
      ...(existing ?? { threadId }),
      threadId,
      recentEventIds: [
        ...(existing?.recentEventIds ?? []).filter(
          (storedEventId) => storedEventId !== eventId,
        ),
        eventId,
      ].slice(-RECENT_EVENT_LIMIT),
      inFlightEventId: eventId,
      inFlightStartedAt: claimedAt,
      updatedAt: claimedAt,
    };
    delete claimed.retentionState;
    this.records.set(key, structuredClone(claimed));
    return {
      status: "claimed",
      record: structuredClone(claimed),
    };
  }

  async replaceClaimedTurn(
    eventId: string,
    record: ThreadRecord,
  ): Promise<boolean> {
    const key = threadKey(record.threadId);
    if (this.records.get(key)?.inFlightEventId !== eventId) {
      return false;
    }
    this.records.set(key, structuredClone(record));
    this.evictOldestRecords();
    return true;
  }

  async claimPendingReview(
    threadId: string,
    interruptId: string,
    claimedAt: Date,
  ): Promise<ThreadRecord | null> {
    const key = threadKey(threadId);
    const record = this.records.get(key);
    if (
      !record ||
      record.pendingInterruptId !== interruptId ||
      (record.pendingReviewState !== undefined &&
        record.pendingReviewState !== "pending")
    ) {
      return null;
    }
    const claimed: ThreadRecord = {
      ...record,
      pendingReviewState: "resuming",
      pendingReviewClaimedAt: claimedAt,
      updatedAt: claimedAt,
    };
    this.records.set(key, structuredClone(claimed));
    return structuredClone(claimed);
  }

  async replaceClaimedReview(
    interruptId: string,
    record: ThreadRecord,
  ): Promise<boolean> {
    const key = threadKey(record.threadId);
    const current = this.records.get(key);
    if (
      current?.pendingInterruptId !== interruptId ||
      current.pendingReviewState !== "resuming"
    ) {
      return false;
    }
    this.records.set(key, structuredClone(record));
    this.evictOldestRecords();
    return true;
  }

  async clearPendingDelivery(
    threadId: string,
    deliveryId: string,
    claimId: string,
  ): Promise<boolean> {
    const key = threadKey(threadId);
    const current = this.records.get(key);
    if (
      current?.pendingDelivery?.id !== deliveryId ||
      current.pendingDelivery.claimId !== claimId
    ) {
      return false;
    }
    const { pendingDelivery: _delivery, ...updated } = current;
    this.records.set(
      key,
      structuredClone({ ...updated, retentionState: "inactive" }),
    );
    return true;
  }

  async claimPendingDelivery(
    threadId: string,
    deliveryId: string,
    claimId: string,
    claimedAt: Date,
  ) {
    const key = threadKey(threadId);
    const current = this.records.get(key);
    const delivery = current?.pendingDelivery;
    const hasActiveClaim =
      delivery?.state === "sending" &&
      (!delivery.claimedAt ||
        claimedAt.getTime() - delivery.claimedAt.getTime() <
          DELIVERY_LEASE_MS);
    if (!current || delivery?.id !== deliveryId || hasActiveClaim) {
      return null;
    }
    const claimed = {
      ...delivery,
      state: "sending" as const,
      attemptCount: (delivery.attemptCount ?? 0) + 1,
      claimId,
      claimedAt,
    };
    this.records.set(key, structuredClone({
      ...current,
      pendingDelivery: claimed,
    }));
    return structuredClone(claimed);
  }

  async close(): Promise<void> {
    this.records.clear();
  }

  private removeExpiredRecords(): void {
    const now = this.now();
    for (const [key, record] of this.records) {
      if (now - record.updatedAt.getTime() > this.ttlMs) {
        this.records.delete(key);
      }
    }
  }

  private evictOldestRecords(): void {
    if (this.records.size <= this.maxEntries) {
      return;
    }
    const entries = [...this.records.entries()].sort(
      ([, left], [, right]) =>
        left.updatedAt.getTime() - right.updatedAt.getTime(),
    );
    for (const [key] of entries.slice(
      0,
      this.records.size - this.maxEntries,
    )) {
      this.records.delete(key);
    }
  }
}
