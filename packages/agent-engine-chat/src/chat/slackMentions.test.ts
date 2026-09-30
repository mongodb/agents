import {
  createMockAdapter,
  createTestMessage,
} from "@chat-adapter/tests";
import { describe, expect, it } from "vitest";

import {
  shouldIgnoreSlackMessageAddressedToSomeoneElse,
  shouldIgnoreUnstructuredSlackMention,
} from "./slackMentions.js";

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

describe("shouldIgnoreSlackMessageAddressedToSomeoneElse", () => {
  it.each([
    ["at the start", "<@U999> can you take this?"],
    ["in the middle", "thanks <@U999> for taking this"],
    ["at the end", "can you take this <@U999>"],
    ["with a display name", "thanks <@U999|ada> for taking this"],
    ["with a bang prefix", "see <@!U999>"],
  ])("ignores a text mention of another user %s", (_where, text) => {
    const message = createTestMessage("message-1", text, {
      raw: {
        type: "message",
        text,
      },
    });

    expect(
      shouldIgnoreSlackMessageAddressedToSomeoneElse(slack, message),
    ).toBe(true);
  });

  it("ignores a structured mention of another user", () => {
    const message = createTestMessage("message-1", "can you take this?", {
      raw: {
        type: "message",
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [{ type: "user", user_id: "U999" }],
              },
            ],
          },
        ],
      },
    });

    expect(
      shouldIgnoreSlackMessageAddressedToSomeoneElse(slack, message),
    ).toBe(true);
  });

  it.each([
    ["at the start", "<@B123> and <@U999> please look"],
    ["in the middle", "please look <@B123> and <@U999>"],
    ["at the end", "please look <@U999> and <@B123>"],
  ])("keeps a message that mentions the bot %s", (_where, text) => {
    const message = createTestMessage("message-1", text, {
      raw: {
        type: "message",
        text,
      },
    });

    expect(
      shouldIgnoreSlackMessageAddressedToSomeoneElse(slack, message),
    ).toBe(false);
  });

  it("keeps a follow-up with no user mention", () => {
    const message = createTestMessage("message-1", "Follow up", {
      raw: {
        type: "message",
        text: "Follow up",
      },
    });

    expect(
      shouldIgnoreSlackMessageAddressedToSomeoneElse(slack, message),
    ).toBe(false);
  });

  it("keeps an app_mention event", () => {
    const message = createTestMessage("message-1", "hello", {
      raw: {
        type: "app_mention",
        text: "hello",
      },
    });

    expect(
      shouldIgnoreSlackMessageAddressedToSomeoneElse(slack, message),
    ).toBe(false);
  });

  it("ignores channel and subteam markers", () => {
    const message = createTestMessage(
      "message-1",
      "<!channel> and <!subteam^S123> FYI",
      {
        raw: {
          type: "message",
          text: "<!channel> and <!subteam^S123> FYI",
        },
      },
    );

    expect(
      shouldIgnoreSlackMessageAddressedToSomeoneElse(slack, message),
    ).toBe(false);
  });

  it("leaves uninspectable and non-Slack messages unchanged", () => {
    const message = createTestMessage("message-1", "hello", {
      raw: {},
    });

    expect(
      shouldIgnoreSlackMessageAddressedToSomeoneElse(slack, message),
    ).toBe(false);
    expect(
      shouldIgnoreSlackMessageAddressedToSomeoneElse(
        createMockAdapter("discord", { botUserId: "B123" }),
        message,
      ),
    ).toBe(false);
  });
});
