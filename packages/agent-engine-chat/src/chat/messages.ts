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
