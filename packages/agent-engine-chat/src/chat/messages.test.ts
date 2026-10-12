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

import { describe, expect, it } from "vitest";

import {
  defaultAgentChatMessages,
  resolveAgentChatMessages,
} from "./messages.js";

describe("sessionLimitReached", () => {
  const { sessionLimitReached } = defaultAgentChatMessages;

  it("rounds the retry estimate up to whole minutes", () => {
    expect(sessionLimitReached("AtlasExplorer", 11 * 60_000 + 1)).toBe(
      "AtlasExplorer has reached its hourly limit for starting or resuming conversations. This limit is shared by everyone using the bot. Please try again in about 12 minutes.",
    );
  });

  it("never suggests retrying in less than a minute", () => {
    expect(sessionLimitReached("AtlasExplorer", 0)).toContain(
      "about 1 minute.",
    );
    expect(sessionLimitReached("AtlasExplorer", 500)).toContain(
      "about 1 minute.",
    );
  });

  it("falls back to an hour when there is no estimate", () => {
    expect(sessionLimitReached("AtlasExplorer")).toContain(
      "Please try again in about an hour.",
    );
  });
});

describe("resolveAgentChatMessages", () => {
  it("returns the shared defaults when nothing is overridden", () => {
    expect(resolveAgentChatMessages()).toBe(defaultAgentChatMessages);
    expect(resolveAgentChatMessages(undefined)).toBe(
      defaultAgentChatMessages,
    );
  });

  it("replaces only the fields a caller supplies", () => {
    const messages = resolveAgentChatMessages({
      emptyPrompt: "Ask about Atlas.",
      reviewCardTitle: "Atlas operation requires approval",
    });

    expect(messages.emptyPrompt).toBe("Ask about Atlas.");
    expect(messages.reviewCardTitle).toBe(
      "Atlas operation requires approval",
    );
    expect(messages.pendingReviewUncertain).toBe(
      defaultAgentChatMessages.pendingReviewUncertain,
    );
    expect(messages.decisionUncertain("AtlasExplorer")).toBe(
      defaultAgentChatMessages.decisionUncertain("AtlasExplorer"),
    );
  });

  it("ignores explicit undefined so the default stays in place", () => {
    const messages = resolveAgentChatMessages({
      emptyPrompt: undefined,
      resumeUncertain: (botName) => `${botName} lost the decision.`,
    });

    expect(messages.emptyPrompt).toBe(
      defaultAgentChatMessages.emptyPrompt,
    );
    expect(messages.resumeUncertain("AtlasExplorer")).toBe(
      "AtlasExplorer lost the decision.",
    );
  });
});
