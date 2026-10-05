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

export type TurnClaimStatus =
  | "claimed"
  | "duplicate"
  | "busy"
  | "pending_review";

export interface TurnClaim {
  status: TurnClaimStatus;
  record: ThreadRecord;
}

export interface ThreadStore {
  get(threadId: string): Promise<ThreadRecord | null>;
  put(record: ThreadRecord): Promise<void>;
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
  close(): Promise<void>;
}

export function threadKey(threadId: string): string {
  return threadId;
}
