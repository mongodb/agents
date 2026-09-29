import type {
  ActionsElement,
  ButtonElement,
  DividerElement,
  PostableCard,
  TextElement,
} from "chat";
import { describe, expect, it } from "vitest";

import {
  buildReviewCard,
  REVIEW_APPROVE_ACTION_ID,
  REVIEW_REJECT_ACTION_ID,
} from "./cards.js";

const BOT_NAME = "TestBot";

const HITL_DESCRIPTION = `MongoDB or Atlas operation pending approval

Tool: mongodb__insert_many
Args: {
  "database": "should-not-appear-from-description"
}`;

describe("buildReviewCard", () => {
  it("creates a title, tool subtitle, and separate JSON code block", () => {
    const message = buildReviewCard(
      [
        {
          name: "mongodb__insert_many",
          args: {
            database: "inventory",
            collection: "items",
            connectionId: "conn-1",
            count: 1,
          },
          description: HITL_DESCRIPTION,
        },
      ],
      "interrupt-1",
      BOT_NAME,
    ) as PostableCard;

    expect(message.fallbackText).toMatch(/requires approval/i);
    expect(message.fallbackText).toContain(BOT_NAME);
    expect(message.card.title).toBe("Atlas operation requires approval");
    expect(message.card.subtitle).toBe("mongodb__insert_many");
    expect(textContents(message)).toEqual([
      `\`\`\`
{
  "database": "inventory",
  "collection": "items",
  "connectionId": "conn-1",
  "count": 1
}
\`\`\``,
      "Only the person who requested this operation can decide it.",
    ]);
    expect(JSON.stringify(message)).not.toContain(HITL_DESCRIPTION);
    expect(JSON.stringify(message)).not.toContain(
      "should-not-appear-from-description",
    );
    expect(dividers(message)).toEqual([]);
    expect(buttons(message)).toEqual([
      {
        type: "button",
        id: REVIEW_APPROVE_ACTION_ID,
        label: "Approve",
        style: "primary",
        value: "interrupt-1",
      },
      {
        type: "button",
        id: REVIEW_REJECT_ACTION_ID,
        label: "Reject",
        style: "danger",
        value: "interrupt-1",
      },
    ]);
    expect(JSON.stringify(message)).not.toMatch(/C123|threadTs|channelId/);
  });

  it("stacks named argument blocks when multiple tools need approval", () => {
    const message = buildReviewCard(
      [
        {
          name: "mongodb__insert_many",
          args: { database: "inventory" },
          description: HITL_DESCRIPTION,
        },
        {
          name: "mongodb__update_one",
          args: { database: "inventory", filter: { sku: "A1" } },
        },
      ],
      "interrupt-2",
      BOT_NAME,
    ) as PostableCard;

    expect(message.card.subtitle).toBe("2 operations");
    expect(textContents(message)).toEqual([
      "mongodb__insert_many",
      `\`\`\`
{
  "database": "inventory"
}
\`\`\``,
      "mongodb__update_one",
      `\`\`\`
{
  "database": "inventory",
  "filter": {
    "sku": "A1"
  }
}
\`\`\``,
      "Only the person who requested this operation can decide it.",
    ]);
    expect(dividers(message)).toHaveLength(1);
    expect(JSON.stringify(message)).not.toContain(HITL_DESCRIPTION);
    expect(buttons(message).map((button) => button.id)).toEqual([
      REVIEW_APPROVE_ACTION_ID,
      REVIEW_REJECT_ACTION_ID,
    ]);
  });

  it("shows only a safe reject action when all operations do not fit", () => {
    const message = buildReviewCard(
      Array.from({ length: 46 }, (_, index) => ({
        name: `mutation_${index}`,
        args: { index },
      })),
      "interrupt-overflow",
      BOT_NAME,
    ) as PostableCard;

    expect(message.card.subtitle).toBe("45 operations");
    expect(buttons(message).map((button) => button.id)).toEqual([
      REVIEW_REJECT_ACTION_ID,
    ]);
    expect(textContents(message).at(-1)).toMatch(/additional action/i);
  });
});

function textContents(message: PostableCard): string[] {
  return message.card.children
    .filter((child): child is TextElement => child.type === "text")
    .map((child) => child.content);
}

function dividers(message: PostableCard): DividerElement[] {
  return message.card.children.filter(
    (child): child is DividerElement => child.type === "divider",
  );
}

function buttons(message: PostableCard): ButtonElement[] {
  return message.card.children
    .filter(
      (child): child is ActionsElement => child.type === "actions",
    )
    .flatMap((actions) =>
      actions.children.filter(
        (child): child is ButtonElement => child.type === "button",
      ),
    );
}
