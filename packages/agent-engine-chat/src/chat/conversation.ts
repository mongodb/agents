import { randomUUID } from "node:crypto";

import type {
  ClientUserMetadata,
  InvocationProgress,
  InvocationProgressHandler,
  InvocationResult,
} from "../magenta/types.js";
import type { ThreadRecord, ThreadStore } from "../store/threadStore.js";
import { buildReviewCard } from "./cards.js";
import { defaultAgentChatMessages } from "./messages.js";
import type {
  ChatHandlerDependencies,
  ConversationSurface,
  HandlerLogger,
} from "./types.js";

const REVIEW_CLAIM_MAX_MS = 10 * 60 * 1_000;

function reviewCardOptions(dependencies: ChatHandlerDependencies) {
  const messages = dependencies.messages ?? defaultAgentChatMessages;
  return {
    title: messages.reviewCardTitle,
  };
}

export interface ConversationMessageInput {
  actorId: string;
  authorIsBot?: boolean;
  client?: string;
  eventId?: string;
  text: string;
  threadId: string;
  user?: ClientUserMetadata;
}

export type InvocationClaim =
  | { kind: "turn"; eventId: string }
  | { kind: "review"; interruptId: string };

export type DeliveryOutcome =
  | "delivered"
  | "none"
  | "busy"
  | "failed"
  | "uncertain";

export async function handleConversationMessage(
  input: ConversationMessageInput,
  dependencies: ChatHandlerDependencies,
): Promise<void> {
  if (
    dependencies.authorizedActorIds &&
    !dependencies.authorizedActorIds.has(input.actorId)
  ) {
    dependencies.logger?.warn?.("Rejected unauthorized actor", {
      actorId: input.actorId,
    });
    if (input.authorIsBot === true) {
      return;
    }
    await dependencies.conversation.post(
      `You are not authorized to use this ${dependencies.botName} bot.`,
    );
    return;
  }

  const message = input.text.trim();
  if (!message) {
    await dependencies.conversation.post(
      (dependencies.messages ?? defaultAgentChatMessages).emptyPrompt,
    );
    return;
  }

  const claimedAt = dependencies.now?.() ?? new Date();
  const eventId = input.eventId ?? randomUUID();
  const claim = await dependencies.store.claimTurn(
    input.threadId,
    eventId,
    claimedAt,
  );
  if (claim.status === "duplicate") {
    await deliverPendingRecord(claim.record, dependencies);
    return;
  }
  if (claim.status === "busy") {
    await dependencies.conversation.post(
      `${dependencies.botName} is already working on another message in this thread. After it responds, send your message again.`,
    );
    return;
  }
  if (claim.status === "pending_review") {
    await handlePendingReview(claim.record, dependencies, claimedAt);
    return;
  }

  let activeRecord = claim.record;
  if (activeRecord.pendingDelivery) {
    const deliveryOutcome = await deliverPendingRecord(
      activeRecord,
      dependencies,
    );
    if (deliveryOutcome !== "delivered") {
      if (deliveryOutcome === "busy") {
        await dependencies.conversation.post(
          `${dependencies.botName} is already finishing another response in this thread. Please wait for it to complete.`,
        );
      } else if (deliveryOutcome === "uncertain") {
        await dependencies.conversation.post(
          `${dependencies.botName} could not safely confirm whether its previous response was delivered. Please check the thread before retrying.`,
        );
      }
      await releaseTurn(eventId, activeRecord, dependencies).catch(
        (error: unknown) => {
          dependencies.logger?.error(
            "Could not release a turn after delivery recovery failed",
            error,
          );
        },
      );
      return;
    }
    const { pendingDelivery: _delivery, ...withoutDelivery } = activeRecord;
    activeRecord = withoutDelivery;
  }

  await dependencies.conversation
    .setStatus(`Initializing ${dependencies.botName}…`)
    .catch((error: unknown) => {
      dependencies.logger?.warn?.("Could not set conversation status", error);
    });

  let result: InvocationResult;
  try {
    result = await dependencies.agent.invokeStream(
      {
        message,
        ...(activeRecord.magentaSessionId
          ? { sessionId: activeRecord.magentaSessionId }
          : {}),
        actorId: input.actorId,
        ...(input.client !== undefined ? { client: input.client } : {}),
        ...(input.user !== undefined ? { user: input.user } : {}),
      },
      createProgressHandler(
        dependencies.conversation,
        dependencies.logger,
        Boolean(activeRecord.magentaSessionId),
      ),
    );
  } catch (error) {
    dependencies.logger?.error(
      `${dependencies.botName} invocation failed`,
      error,
    );
    const released = await releaseTurn(
      eventId,
      activeRecord,
      dependencies,
    ).catch((storeError: unknown) => {
      dependencies.logger?.error(
        "Could not release failed conversation turn",
        storeError,
      );
      return false;
    });
    if (released) {
      await dependencies.conversation.post(
        `${dependencies.botName} could not complete that request. Please try again in a moment.`,
      );
    }
    return;
  }

  try {
    await publishInvocationResult(input, result, dependencies, {
      kind: "turn",
      eventId,
    });
  } catch (error) {
    dependencies.logger?.error(
      `${dependencies.botName} result could not be published`,
      error,
    );
    await dependencies.conversation
      .post(
        `${dependencies.botName} completed the request, but this chat could not display the result. Send a follow-up in this thread to continue.`,
      )
      .catch(() => undefined);
  }
}

export function createProgressHandler(
  conversation: ConversationSurface,
  logger?: HandlerLogger,
  showFilesystemLs = true,
): InvocationProgressHandler {
  const publishStatus = async (progress: InvocationProgress): Promise<void> => {
    const status = progress.content.trim();
    if (!status) {
      return;
    }
    await conversation
      .setStatus(status.slice(0, 100))
      .catch((error: unknown) => {
        logger?.warn?.("Could not update conversation progress status", error);
      });
  };

  return async (progress) => {
    if (isFilesystemDownload(progress)) {
      showFilesystemLs = true;
      return;
    }
    if (isFilesystemLs(progress) && !showFilesystemLs) {
      return;
    }
    await publishStatus(progress);
  };
}

function progressToolName(progress: InvocationProgress): string {
  return progress.toolName?.trim() ?? "";
}

function isFilesystemDownload(progress: InvocationProgress): boolean {
  return progressToolName(progress) === "filesystem_download";
}

function isFilesystemLs(progress: InvocationProgress): boolean {
  return progressToolName(progress) === "filesystem_ls";
}

export async function publishInvocationResult(
  input: Pick<ConversationMessageInput, "actorId" | "threadId">,
  result: InvocationResult,
  dependencies: ChatHandlerDependencies,
  claim: InvocationClaim,
): Promise<boolean> {
  const updatedAt = dependencies.now?.() ?? new Date();
  const current = await dependencies.store.get(input.threadId);
  const continuity = current?.recentEventIds
    ? { recentEventIds: current.recentEventIds }
    : {};

  if (result.kind === "completed") {
    const deliveryId =
      claim.kind === "turn" ? claim.eventId : `review:${claim.interruptId}`;
    const record: ThreadRecord = {
      threadId: input.threadId,
      magentaSessionId: result.sessionId,
      pendingDelivery: {
        id: deliveryId,
        text: result.response,
        state: "pending",
        attemptCount: 0,
      },
      retentionState: "delivery_pending",
      ...continuity,
      updatedAt,
    };
    const stored = await replaceClaimedRecord(
      record,
      claim,
      dependencies.store,
    );
    if (!stored) {
      dependencies.logger?.warn?.(
        "Discarded a result from a stale conversation claim",
        claim,
      );
      return false;
    }
    const outcome = await deliverPendingRecord(record, dependencies);
    if (outcome === "failed" || outcome === "uncertain") {
      throw new Error("Response delivery failed");
    }
    return outcome === "delivered";
  }

  const interrupt = result.interrupts[0];
  if (!interrupt) {
    throw new Error("Suspended invocation did not include an interrupt");
  }
  const actionRequests = result.interrupts.flatMap(
    (pendingInterrupt) => pendingInterrupt.actionRequests,
  );
  const record: ThreadRecord = {
    threadId: input.threadId,
    magentaSessionId: result.sessionId,
    pendingExecutionId: result.executionId,
    pendingInterruptId: interrupt.id,
    pendingInterrupts: result.interrupts,
    pendingActionRequests: actionRequests,
    pendingRequestedByActorId: input.actorId,
    pendingReviewState: "pending",
    ...continuity,
    ...(result.resumeSchema
      ? { pendingResumeSchema: result.resumeSchema }
      : {}),
    updatedAt,
  };
  const stored = await replaceClaimedRecord(record, claim, dependencies.store);
  if (!stored) {
    dependencies.logger?.warn?.(
      "Discarded a suspension from a stale conversation claim",
      claim,
    );
    return false;
  }
  await dependencies.conversation.post(
    buildReviewCard(
      actionRequests,
      interrupt.id,
      dependencies.botName,
      reviewCardOptions(dependencies),
    ),
  );
  return true;
}

export async function recoverPendingDelivery(
  threadId: string,
  dependencies: ChatHandlerDependencies,
): Promise<DeliveryOutcome> {
  const record = await dependencies.store.get(threadId);
  if (!record) {
    return "none";
  }
  return deliverPendingRecord(record, dependencies);
}

async function handlePendingReview(
  record: ThreadRecord,
  dependencies: ChatHandlerDependencies,
  claimedAt: Date,
): Promise<void> {
  if (record.pendingReviewState === "uncertain") {
    await dependencies.conversation.post(
      (dependencies.messages ?? defaultAgentChatMessages).pendingReviewUncertain,
    );
    return;
  }
  if (record.pendingReviewState === "resuming") {
    const reviewClaimExpired =
      !record.pendingReviewClaimedAt ||
      claimedAt.getTime() - record.pendingReviewClaimedAt.getTime() >=
        REVIEW_CLAIM_MAX_MS;
    if (reviewClaimExpired && record.pendingInterruptId) {
      const { pendingReviewClaimedAt: _reviewClaimedAt, ...uncertainRecord } =
        record;
      const stored = await dependencies.store.replaceClaimedReview(
        record.pendingInterruptId,
        {
          ...uncertainRecord,
          pendingReviewState: "uncertain",
          updatedAt: claimedAt,
        },
      );
      if (stored) {
        await dependencies.conversation.post(
          (dependencies.messages ?? defaultAgentChatMessages).resumeUncertain(
            dependencies.botName,
          ),
        );
      }
      return;
    }
    await dependencies.conversation.post(
      `The mutation decision is being processed. Wait for ${dependencies.botName} to finish before sending another message.`,
    );
    return;
  }
  if (record.pendingActionRequests?.length && record.pendingInterruptId) {
    await dependencies.conversation.post(
      buildReviewCard(
        record.pendingActionRequests,
        record.pendingInterruptId,
        dependencies.botName,
        reviewCardOptions(dependencies),
      ),
    );
    return;
  }
  await dependencies.conversation.post(
    "This thread is waiting for a mutation decision. Use the existing approval buttons before sending another message.",
  );
}

async function releaseTurn(
  eventId: string,
  record: ThreadRecord,
  dependencies: ChatHandlerDependencies,
): Promise<boolean> {
  const {
    inFlightEventId: _eventId,
    inFlightStartedAt: _startedAt,
    ...released
  } = record;
  return dependencies.store.replaceClaimedTurn(eventId, {
    ...released,
    ...(released.pendingDelivery
      ? { retentionState: "delivery_pending" as const }
      : { retentionState: "inactive" as const }),
    updatedAt: dependencies.now?.() ?? new Date(),
  });
}

function replaceClaimedRecord(
  record: ThreadRecord,
  claim: InvocationClaim,
  store: ThreadStore,
): Promise<boolean> {
  return claim.kind === "turn"
    ? store.replaceClaimedTurn(claim.eventId, record)
    : store.replaceClaimedReview(claim.interruptId, record);
}

async function deliverPendingRecord(
  record: ThreadRecord,
  dependencies: ChatHandlerDependencies,
): Promise<DeliveryOutcome> {
  const delivery = record.pendingDelivery;
  if (!delivery) {
    return "none";
  }
  const claimId = randomUUID();
  const claimed = await dependencies.store.claimPendingDelivery(
    record.threadId,
    delivery.id,
    claimId,
    dependencies.now?.() ?? new Date(),
  );
  if (!claimed) {
    return "busy";
  }

  try {
    if ((claimed.attemptCount ?? 1) > 1) {
      const status = await dependencies.conversation.getDeliveryStatus(
        delivery.id,
      );
      if (status === "delivered") {
        await dependencies.store.clearPendingDelivery(
          record.threadId,
          delivery.id,
          claimId,
        );
        return "delivered";
      }
      if (status === "unknown") {
        dependencies.logger?.warn?.(
          "Could not safely reconcile a pending response delivery",
          { deliveryId: delivery.id, threadId: record.threadId },
        );
        return "uncertain";
      }
    }

    await dependencies.conversation.deliver(delivery.text, delivery.id);
    await dependencies.store.clearPendingDelivery(
      record.threadId,
      delivery.id,
      claimId,
    );
    return "delivered";
  } catch (error) {
    dependencies.logger?.error("Could not deliver a stored response", error);
    return "failed";
  }
}
