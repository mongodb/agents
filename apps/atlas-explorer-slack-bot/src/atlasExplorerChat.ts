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
