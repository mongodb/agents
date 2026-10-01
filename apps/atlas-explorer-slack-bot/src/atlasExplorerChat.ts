import type { AgentChatMessages } from "@repo/agent-engine-chat/chat";

export const atlasExplorerChatMessages: Partial<AgentChatMessages> = {
  decisionUncertain: (botName) =>
    `The decision was sent, but ${botName} could not confirm whether it completed. Check Atlas before retrying, then start a new conversation.`,
  emptyPrompt:
    "Ask me about your MongoDB databases or Atlas resources.",
  pendingReviewUncertain:
    "The previous mutation decision has an uncertain outcome. Check Atlas before retrying, then start a new conversation.",
  resumeUncertain: (botName) =>
    `${botName} could not confirm whether the earlier mutation decision completed. Check Atlas before retrying, then start a new conversation.`,
  reviewCardTitle: "Atlas operation requires approval",
  reviewStatusUncertain:
    "Decision submitted, but its outcome could not be confirmed. Check Atlas before retrying.",
};
