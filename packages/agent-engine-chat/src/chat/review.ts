import { AgenticApiError } from "../magenta/client.js";
import type { ClientUserMetadata } from "../magenta/types.js";
import {
  createProgressHandler,
  publishInvocationResult,
} from "./conversation.js";
import { defaultAgentChatMessages } from "./messages.js";
import type { ChatHandlerDependencies } from "./types.js";

export type ReviewOutcome =
  | "completed"
  | "suspended"
  | "missing"
  | "unauthorized"
  | "uncertain"
  | "failed";

export interface ReviewInput {
  actorId: string;
  client?: string;
  decision: "approve" | "reject";
  interruptId: string;
  threadId: string;
  user?: ClientUserMetadata;
}

export async function handleReviewDecision(
  input: ReviewInput,
  dependencies: ChatHandlerDependencies,
): Promise<ReviewOutcome> {
  if (
    dependencies.authorizedActorIds &&
    !dependencies.authorizedActorIds.has(input.actorId)
  ) {
    dependencies.logger?.warn?.(
      "Rejected unauthorized actor",
      { actorId: input.actorId },
    );
    await dependencies.conversation.post(
      `You are not authorized to use this ${dependencies.botName} bot.`,
    );
    return "unauthorized";
  }

  const record = await dependencies.store.get(input.threadId);
  if (
    !record?.pendingInterruptId ||
    !record.magentaSessionId ||
    record.pendingInterruptId !== input.interruptId
  ) {
    await dependencies.conversation.post(
      "That review is no longer pending or has been replaced by a newer request.",
    );
    return "missing";
  }
  const sessionId = record.magentaSessionId;

  if (
    !record.pendingRequestedByActorId ||
    record.pendingRequestedByActorId !== input.actorId
  ) {
    await dependencies.conversation.post(
      "Only the requester can approve or reject this operation.",
    );
    return "unauthorized";
  }

  const claimed = await dependencies.store.claimPendingReview(
    input.threadId,
    input.interruptId,
    dependencies.now?.() ?? new Date(),
  );
  if (!claimed) {
    await dependencies.conversation.post(
      "That review is already being handled or is no longer pending.",
    );
    return "missing";
  }

  const interrupts = claimed.pendingInterrupts?.length
    ? claimed.pendingInterrupts
    : [
        {
          id: input.interruptId,
          actionRequests: claimed.pendingActionRequests ?? [],
        },
      ];
  const interruptDecisions = interrupts.map((interrupt) => ({
    interruptId: interrupt.id,
    decision: buildDecisions(
      Math.max(interrupt.actionRequests.length, 1),
      input.decision,
    ),
  }));
  const [primaryDecision, ...additionalInterrupts] =
    interruptDecisions;
  if (!primaryDecision) {
    return "missing";
  }

  await dependencies.conversation
    .setStatus(
      input.decision === "approve"
        ? "Applying approved operation…"
        : "Recording rejection…",
    )
    .catch((error: unknown) => {
      dependencies.logger?.warn?.(
        "Could not set conversation status",
        error,
      );
    });

  let result;
  try {
    result = await dependencies.agent.resumeStream(
      {
        sessionId,
        ...primaryDecision,
        ...(additionalInterrupts.length
          ? { additionalInterrupts }
          : {}),
        actorId: input.actorId,
        ...(input.client !== undefined ? { client: input.client } : {}),
        ...(input.user !== undefined ? { user: input.user } : {}),
      },
      createProgressHandler(
        dependencies.conversation,
        dependencies.logger,
        true,
      ),
    );
  } catch (error) {
    dependencies.logger?.error(
      `${dependencies.botName} review resume failed`,
      error,
    );
    const outcomeWasConfirmedNotApplied =
      error instanceof AgenticApiError &&
      error.requestOutcome !== "unknown";
    const {
      pendingReviewClaimedAt: _claimedAt,
      ...reviewRecord
    } = claimed;
    const stored = await dependencies.store.replaceClaimedReview(
      input.interruptId,
      {
        ...reviewRecord,
        pendingReviewState: outcomeWasConfirmedNotApplied
          ? "pending"
          : "uncertain",
        updatedAt: dependencies.now?.() ?? new Date(),
      },
    );
    if (!stored) {
      return "missing";
    }
    if (!outcomeWasConfirmedNotApplied) {
      await dependencies.conversation
        .updateReviewStatus?.("uncertain")
        .catch(() => undefined);
      await dependencies.conversation.post(
        (dependencies.messages ?? defaultAgentChatMessages).decisionUncertain(
          dependencies.botName,
        ),
      );
      return "uncertain";
    }
    await dependencies.conversation.post(
      `${dependencies.botName} could not apply that decision. The review is still pending; please try again.`,
    );
    return "failed";
  }

  try {
    const published = await publishInvocationResult(
      input,
      result,
      dependencies,
      { kind: "review", interruptId: input.interruptId },
    );
    if (!published) {
      return "missing";
    }
  } catch (error) {
    dependencies.logger?.error(
      "The review was applied but its result could not be published",
      error,
    );
    await dependencies.conversation
      .post(
        "The decision was applied, but this chat could not display the result. Send a follow-up in this thread to continue.",
      )
      .catch(() => undefined);
  }

  try {
    await dependencies.conversation.updateReviewStatus?.(
      input.decision === "approve" ? "approved" : "rejected",
    );
  } catch (error) {
    dependencies.logger?.warn?.(
      "Could not update the original review message",
      error,
    );
  }

  return result.kind;
}

function buildDecisions(
  actionCount: number,
  decision: "approve" | "reject",
) {
  return Array.from({ length: actionCount }, () =>
    decision === "approve"
      ? ({ type: "approve" } as const)
      : ({
          type: "reject",
          message: "The chat user rejected this operation.",
        } as const),
  );
}
