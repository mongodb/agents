import { expect } from "vitest";

import type { ThreadRecord, ThreadStore } from "./threadStore.js";

export const baseRecord: Omit<ThreadRecord, "updatedAt"> = {
  threadId: "slack:C123:1720000000.000100",
  magentaSessionId: "session-1",
};

export async function exercisesRoundTrip(
  store: ThreadStore,
): Promise<void> {
  const record: ThreadRecord = {
    ...baseRecord,
    pendingExecutionId: "execution-1",
    pendingInterruptId: "interrupt-1",
    pendingResumeSchema: { type: "object" },
    pendingRequestedByActorId: "slack:U123",
    updatedAt: new Date("2026-09-08T12:00:00.000Z"),
  };

  await store.put(record);

  expect(await store.get(record.threadId)).toEqual(record);
  expect(await store.get("slack:C-other:1")).toBeNull();
}

export async function exercisesReviewClaim(
  store: ThreadStore,
): Promise<void> {
  await store.put({
    ...baseRecord,
    pendingExecutionId: "execution-1",
    pendingInterruptId: "interrupt-1",
    pendingReviewState: "pending",
    updatedAt: new Date("2026-09-08T12:00:00.000Z"),
  });

  const claims = await Promise.all([
    store.claimPendingReview(
      baseRecord.threadId,
      "interrupt-1",
      new Date("2026-09-08T12:01:00.000Z"),
    ),
    store.claimPendingReview(
      baseRecord.threadId,
      "interrupt-1",
      new Date("2026-09-08T12:01:00.000Z"),
    ),
  ]);

  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(claims.find(Boolean)).toMatchObject({
    pendingInterruptId: "interrupt-1",
    pendingReviewState: "resuming",
  });

  await store.put({
    ...baseRecord,
    pendingExecutionId: "execution-2",
    pendingInterruptId: "interrupt-2",
    pendingReviewState: "pending",
    updatedAt: new Date("2026-09-08T12:02:00.000Z"),
  });
  expect(
    await store.replaceClaimedReview("interrupt-1", {
      ...baseRecord,
      updatedAt: new Date("2026-09-08T12:02:01.000Z"),
    }),
  ).toBe(false);
  expect(
    await store.claimPendingReview(
      baseRecord.threadId,
      "stale-interrupt",
      new Date(),
    ),
  ).toBeNull();
  await expect(store.get(baseRecord.threadId)).resolves.toMatchObject({
    pendingInterruptId: "interrupt-2",
  });
}

export async function exercisesTurnClaim(
  store: ThreadStore,
): Promise<void> {
  const [first, duplicate] = await Promise.all([
    store.claimTurn(
      baseRecord.threadId,
      "event-1",
      new Date("2026-09-08T12:00:00.000Z"),
    ),
    store.claimTurn(
      baseRecord.threadId,
      "event-1",
      new Date("2026-09-08T12:00:00.000Z"),
    ),
  ]);

  expect([first.status, duplicate.status].sort()).toEqual([
    "claimed",
    "duplicate",
  ]);
  expect(
    (
      await store.claimTurn(
        baseRecord.threadId,
        "event-2",
        new Date("2026-09-08T12:01:00.000Z"),
      )
    ).status,
  ).toBe("busy");

  const active = await store.get(baseRecord.threadId);
  expect(active).not.toBeNull();
  await store.put({
    ...active!,
    inFlightEventId: undefined,
    inFlightStartedAt: undefined,
  });
  const next = await store.claimTurn(
    baseRecord.threadId,
    "event-2",
    new Date("2026-09-08T12:02:00.000Z"),
  );
  expect(next.status).toBe("claimed");
  const {
    inFlightEventId: _eventId,
    inFlightStartedAt: _startedAt,
    ...finishedRecord
  } = next.record;
  expect(
    await store.replaceClaimedTurn("event-1", {
      ...finishedRecord,
      magentaSessionId: "stale-session",
      updatedAt: new Date("2026-09-08T12:02:01.000Z"),
    }),
  ).toBe(false);
  expect(
    await store.replaceClaimedTurn("event-2", {
      ...finishedRecord,
      magentaSessionId: "current-session",
      updatedAt: new Date("2026-09-08T12:02:01.000Z"),
    }),
  ).toBe(true);
  await expect(store.get(baseRecord.threadId)).resolves.toMatchObject({
    magentaSessionId: "current-session",
  });
}

export async function exercisesDeliveryCompletion(
  store: ThreadStore,
): Promise<void> {
  await store.put({
    ...baseRecord,
    pendingDelivery: {
      id: "delivery-1",
      text: "Recovered response",
      state: "pending",
    },
    updatedAt: new Date("2026-09-08T12:00:00.000Z"),
  });

  const claims = await Promise.all([
    store.claimPendingDelivery(
      baseRecord.threadId,
      "delivery-1",
      "claim-1",
      new Date("2026-09-08T12:01:00.000Z"),
    ),
    store.claimPendingDelivery(
      baseRecord.threadId,
      "delivery-1",
      "claim-2",
      new Date("2026-09-08T12:01:00.000Z"),
    ),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claimed = claims.find(Boolean)!;
  expect(claimed.state).toBe("sending");
  expect(
    await store.clearPendingDelivery(
      baseRecord.threadId,
      "delivery-1",
      claimed.claimId === "claim-1" ? "claim-2" : "claim-1",
    ),
  ).toBe(false);
  const reclaimed = await store.claimPendingDelivery(
    baseRecord.threadId,
    "delivery-1",
    "claim-3",
    new Date("2026-09-08T12:07:00.000Z"),
  );
  expect(reclaimed).toMatchObject({
    claimId: "claim-3",
    attemptCount: 2,
  });
  expect(
    await store.clearPendingDelivery(
      baseRecord.threadId,
      "delivery-1",
      claimed.claimId!,
    ),
  ).toBe(false);
  expect(
    await store.clearPendingDelivery(
      baseRecord.threadId,
      "delivery-1",
      "claim-3",
    ),
  ).toBe(true);
  await expect(store.get(baseRecord.threadId)).resolves.toEqual(
    expect.not.objectContaining({
      pendingDelivery: expect.anything(),
    }),
  );
}
