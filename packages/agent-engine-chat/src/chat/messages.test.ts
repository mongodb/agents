import { describe, expect, it } from "vitest";

import {
  defaultAgentChatMessages,
  resolveAgentChatMessages,
} from "./messages.js";

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
