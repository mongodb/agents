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

import type {
  AgentActionRequest,
  AgentInterrupt,
} from "../agent-engine/types.js";

export interface ThreadRecord {
  threadId: string;
  agentSessionId?: string;
  recentEventIds?: string[];
  inFlightEventId?: string;
  inFlightStartedAt?: Date;
  pendingExecutionId?: string;
  pendingInterruptId?: string;
  pendingInterrupts?: AgentInterrupt[];
  pendingResumeSchema?: Record<string, unknown>;
  pendingActionRequests?: AgentActionRequest[];
  pendingRequestedByActorId?: string;
  pendingReviewState?: "pending" | "resuming" | "uncertain";
  pendingReviewClaimedAt?: Date;
  pendingDelivery?: PendingDelivery;
  retentionState?: "inactive" | "delivery_pending";
  updatedAt: Date;
}

export interface PendingDelivery {
  id: string;
  text: string;
  state?: "pending" | "sending";
  attemptCount?: number;
  claimId?: string;
  claimedAt?: Date;
}

/** Every field that describes a review waiting on, or resuming from, a decision. */
export const PENDING_REVIEW_FIELDS = [
  "pendingExecutionId",
  "pendingInterruptId",
  "pendingInterrupts",
  "pendingResumeSchema",
  "pendingActionRequests",
  "pendingRequestedByActorId",
  "pendingReviewState",
  "pendingReviewClaimedAt",
] as const satisfies readonly (keyof ThreadRecord)[];

export function withoutPendingReview(record: ThreadRecord): ThreadRecord {
  const cleared = { ...record };
  for (const field of PENDING_REVIEW_FIELDS) {
    delete cleared[field];
  }
  return cleared;
}

export type TurnClaim =
  | {
      status: "claimed";
      record: ThreadRecord;
      /**
       * The thread as it was just before this claim, read in the same atomic
       * operation, or null for a new thread. Claiming overwrites `updatedAt`,
       * so this is the only reliable way to tell how long the thread was idle.
       */
      previousRecord: ThreadRecord | null;
    }
  | { status: "duplicate"; record: ThreadRecord }
  | { status: "busy"; record: ThreadRecord }
  | { status: "pending_review"; record: ThreadRecord };

export type TurnClaimStatus = TurnClaim["status"];

export interface ThreadStore {
  get(threadId: string): Promise<ThreadRecord | null>;
  put(record: ThreadRecord): Promise<void>;
  /**
   * Claims the thread for one turn. A review marked `uncertain` doesn't block
   * the claim: the turn takes over the thread, drops the review's `pending*`
   * fields, and keeps `agentSessionId` so the conversation continues.
   */
  claimTurn(
    threadId: string,
    eventId: string,
    claimedAt: Date,
  ): Promise<TurnClaim>;
  replaceClaimedTurn(
    eventId: string,
    record: ThreadRecord,
  ): Promise<boolean>;
  claimPendingReview(
    threadId: string,
    interruptId: string,
    claimedAt: Date,
  ): Promise<ThreadRecord | null>;
  /**
   * Replaces a review this caller claimed. It also matches a review marked
   * `uncertain`, so the claiming resume can still finish when a later message
   * gave up on it.
   */
  replaceClaimedReview(
    interruptId: string,
    record: ThreadRecord,
  ): Promise<boolean>;
  claimPendingDelivery(
    threadId: string,
    deliveryId: string,
    claimId: string,
    claimedAt: Date,
  ): Promise<PendingDelivery | null>;
  clearPendingDelivery(
    threadId: string,
    deliveryId: string,
    claimId: string,
  ): Promise<boolean>;
  /**
   * Returns the `updatedAt` of every thread other than `excludeThreadId` that
   * has run the agent, or is running it now, and was updated at or after
   * `since`. Values are in ascending order.
   *
   * This reads existing thread metadata only; it is how callers measure how
   * many agent sessions are active without keeping a separate counter.
   */
  listRecentSessionActivity(
    since: Date,
    excludeThreadId: string,
  ): Promise<Date[]>;
  close(): Promise<void>;
}

/**
 * How long a claimed turn or review is trusted to still be running. A claim
 * older than this is treated as abandoned by a crashed handler. It must stay
 * longer than the Agent Engine client's request timeout, so a call that is
 * still alive can never look abandoned.
 */
export const CLAIM_LEASE_MS = 10 * 60 * 1_000;

export function threadKey(threadId: string): string {
  return threadId;
}
