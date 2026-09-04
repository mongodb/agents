import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { createMiddleware } from "langchain";

import { MUTATIVE_MCP_INTERRUPT_ON } from "./agentPolicy.js";

export interface HumanReview {
  decision: "approve" | "reject";
  reviewerNotes?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseHumanReview(value: unknown): HumanReview {
  if (!isRecord(value)) {
    throw new Error("Invalid Magenta HITL resume: expected an object");
  }

  const review = isRecord(value.human_review) ? value.human_review : value;
  const decision = review.decision;
  if (typeof decision !== "string") {
    throw new Error("Invalid Magenta HITL resume: missing decision");
  }

  const normalizedDecision = decision.toLowerCase();
  if (normalizedDecision !== "approve" && normalizedDecision !== "reject") {
    throw new Error(
      `Invalid Magenta HITL resume: expected "approve" or "reject", got ${JSON.stringify(decision)}`,
    );
  }

  const reviewerNotes = review.reviewer_notes;
  return {
    decision: normalizedDecision,
    ...(typeof reviewerNotes === "string" ? { reviewerNotes } : {}),
  };
}

export const mutativeToolReviewMiddleware = createMiddleware({
  name: "magentaMutativeToolReview",
  afterModel: {
    canJumpTo: ["model"],
    hook: async (state) => {
      const lastMessage = [...state.messages]
        .reverse()
        .find(AIMessage.isInstance);
      if (!lastMessage?.tool_calls?.length) return;

      const pending = lastMessage.tool_calls
        .filter(
          (toolCall) => MUTATIVE_MCP_INTERRUPT_ON[toolCall.name] === true,
        )
        .map((toolCall) => {
          if (typeof toolCall.id !== "string" || toolCall.id.length === 0) {
            throw new Error(
              `Cannot review protected tool "${toolCall.name}": missing tool call id`,
            );
          }
          return { ...toolCall, id: toolCall.id };
        });
      if (pending.length === 0) return;
      const hasUnreviewedToolCalls = lastMessage.tool_calls.some(
        (toolCall) => MUTATIVE_MCP_INTERRUPT_ON[toolCall.name] !== true,
      );

      const firstTool = pending[0];
      const review = parseHumanReview(
        interrupt({
          suspend_reason: "awaiting_human_review",
          suspend_context: {
            allowed_decisions: ["approve", "reject"],
            instructions:
              "Approve to execute this MongoDB/Atlas mutation, or reject to skip it.",
            tool_name: firstTool.name,
            arguments: firstTool.args,
            tools: pending.map(({ id, name, args }) => ({ id, name, args })),
          },
        }),
      );

      if (review.decision === "approve") return;
      if (review.decision !== "reject") {
        throw new Error(
          `Unsupported human review decision: ${review.decision}`,
        );
      }

      const reviewerContext = review.reviewerNotes
        ? ` Reviewer notes: ${review.reviewerNotes}`
        : "";
      const rejectionUpdate = {
        messages: [
          lastMessage,
          ...pending.map(
            (toolCall) =>
              new ToolMessage({
                content:
                  `User rejected the tool call for \`${toolCall.name}\`.` +
                  reviewerContext,
                name: toolCall.name,
                tool_call_id: toolCall.id,
                status: "error",
              }),
          ),
        ],
      };
      return hasUnreviewedToolCalls
        ? rejectionUpdate
        : { ...rejectionUpdate, jumpTo: "model" as const };
    },
  },
});
