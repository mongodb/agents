import type {
  AgentActionRequest,
  AgentInterrupt,
} from "../agent-engine/types.js";

export interface ThreadRecord {
  threadId: string;
  magentaSessionId?: string;
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
