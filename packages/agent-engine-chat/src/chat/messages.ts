export interface AgentChatMessages {
  decisionUncertain: (botName: string) => string;
  emptyPrompt: string;
  pendingReviewUncertain: string;
  resumeUncertain: (botName: string) => string;
  reviewCardTitle: string;
  reviewStatusUncertain: string;
}

export const defaultAgentChatMessages: AgentChatMessages = {
  decisionUncertain: (botName) =>
    `The decision was sent, but ${botName} could not confirm whether it completed. Check the target system before retrying, then start a new conversation.`,
  emptyPrompt: "Send a message to continue.",
  pendingReviewUncertain:
    "The previous mutation decision has an uncertain outcome. Check the target system before retrying, then start a new conversation.",
  resumeUncertain: (botName) =>
    `${botName} could not confirm whether the earlier mutation decision completed. Check the target system before retrying, then start a new conversation.`,
  reviewCardTitle: "Agent operation requires approval",
  reviewStatusUncertain:
    "Decision submitted, but its outcome could not be confirmed. Check the target system before retrying.",
};

export function resolveAgentChatMessages(
  overrides?: Partial<AgentChatMessages>,
): AgentChatMessages {
  if (!overrides) {
    return defaultAgentChatMessages;
  }
  return {
    ...defaultAgentChatMessages,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    ),
  };
}
