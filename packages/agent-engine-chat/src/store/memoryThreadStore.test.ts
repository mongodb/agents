import { describe, expect, it } from "vitest";

import { MemoryThreadStore } from "./memoryThreadStore.js";
import {
  baseRecord,
  exercisesDeliveryCompletion,
  exercisesReviewClaim,
  exercisesRoundTrip,
  exercisesTurnClaim,
} from "./threadStore.test-helpers.js";

const TEST_NOW = Date.parse("2026-09-08T12:03:00.000Z");

function createStore(
  options: ConstructorParameters<typeof MemoryThreadStore>[0] = {},
): MemoryThreadStore {
  return new MemoryThreadStore({
    now: () => TEST_NOW,
    ...options,
  });
}

describe("MemoryThreadStore", () => {
  it("round-trips a chat-to-Agent Engine thread record", async () => {
    await exercisesRoundTrip(createStore());
  });

  it("expires records after the configured TTL", async () => {
    let now = Date.parse("2026-09-08T12:00:00.000Z");
    const store = new MemoryThreadStore({
      ttlMs: 60_000,
      now: () => now,
    });
    await store.put({
      ...baseRecord,
      updatedAt: new Date(now),
    });

    now += 60_001;

    expect(await store.get(baseRecord.threadId)).toBeNull();
  });

  it("evicts the least recently updated record at capacity", async () => {
    const store = createStore({ maxEntries: 2 });
    await store.put({
      ...baseRecord,
      threadId: "slack:C123:1",
      updatedAt: new Date("2026-09-08T12:00:00.000Z"),
    });
    await store.put({
      ...baseRecord,
      threadId: "slack:C123:2",
      updatedAt: new Date("2026-09-08T12:01:00.000Z"),
    });
    await store.put({
      ...baseRecord,
      threadId: "slack:C123:3",
      updatedAt: new Date("2026-09-08T12:02:00.000Z"),
    });

    expect(await store.get("slack:C123:1")).toBeNull();
    expect(await store.get("slack:C123:2")).not.toBeNull();
    expect(await store.get("slack:C123:3")).not.toBeNull();
  });

  it("atomically claims one reviewer for the pending interrupt", async () => {
    await exercisesReviewClaim(createStore());
  });

  it("deduplicates events and serializes turns in a chat thread", async () => {
    await exercisesTurnClaim(createStore());
  });

  it("conditionally clears a delivered Slack response", async () => {
    await exercisesDeliveryCompletion(createStore());
  });
});
