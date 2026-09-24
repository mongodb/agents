import {
  createMockAdapter,
  createTestMessage,
} from "@chat-adapter/tests";
import { describe, expect, it } from "vitest";

import { shouldIgnoreUnstructuredSlackMention } from "./slackMentions.js";

const slack = createMockAdapter("slack", {
  botUserId: "B123",
});

describe("shouldIgnoreUnstructuredSlackMention", () => {
  it("ignores another Slack user's structured mention", () => {
    const message = createTestMessage(
      "message-1",
      "@AtlasExplorer Local hello",
      {
        raw: {
          type: "message",
          text: "<@B999|AtlasExplorer Local> hello",
        },
      },
    );

    expect(
      shouldIgnoreUnstructuredSlackMention(slack, message),
    ).toBe(true);
  });

  it.each([
    {
      type: "message",
      text: "<@B123|AtlasExplorer> hello",
    },
    {
      type: "message",
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [{ type: "user", user_id: "B123" }],
            },
          ],
        },
      ],
    },
    {
      type: "app_mention",
      text: "hello",
    },
  ])("accepts an authoritative Slack mention", (raw) => {
    const message = createTestMessage("message-1", "hello", {
      raw,
    });

    expect(
      shouldIgnoreUnstructuredSlackMention(slack, message),
    ).toBe(false);
  });

  it("leaves uninspectable and non-Slack messages unchanged", () => {
    const message = createTestMessage("message-1", "hello", {
      raw: {},
    });

    expect(
      shouldIgnoreUnstructuredSlackMention(slack, message),
    ).toBe(false);
    expect(
      shouldIgnoreUnstructuredSlackMention(
        createMockAdapter("discord", { botUserId: "B123" }),
        message,
      ),
    ).toBe(false);
  });
});
