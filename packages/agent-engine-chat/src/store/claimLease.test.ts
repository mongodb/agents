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

import { describe, expect, it } from "vitest";

import { DEFAULT_REQUEST_TIMEOUT_MS } from "../agent-engine/client.js";
import { MemoryThreadStore } from "./memoryThreadStore.js";
import { CLAIM_LEASE_MS } from "./threadStore.js";

const THREAD_ID = "slack:C123:1720000000.000100";

describe("claim lease", () => {
  it("outlasts the longest request the Agent Engine client allows", () => {
    // A live invoke or resume is always aborted before its claim can look
    // abandoned, so only a crashed handler is ever taken over.
    expect(CLAIM_LEASE_MS).toBeGreaterThan(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it("keeps a turn busy right up to the lease and frees it after", async () => {
    const store = new MemoryThreadStore();
    const startedAt = new Date("2026-09-08T12:00:00.000Z");
    await store.claimTurn(THREAD_ID, "event-1", startedAt);

    const justBefore = new Date(startedAt.getTime() + CLAIM_LEASE_MS - 1);
    const atLease = new Date(startedAt.getTime() + CLAIM_LEASE_MS);

    expect(
      (await store.claimTurn(THREAD_ID, "event-2", justBefore)).status,
    ).toBe("busy");
    expect(
      (await store.claimTurn(THREAD_ID, "event-2", atLease)).status,
    ).toBe("claimed");
  });
});
