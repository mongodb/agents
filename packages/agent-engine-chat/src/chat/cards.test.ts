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

import { cardToBlockKit } from "@chat-adapter/slack";
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
  MAX_ARGUMENT_TEXT,
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
    expect(message.card.title).toBe("Agent operation requires approval");
    expect(message.card.subtitle).toBe("mongodb__insert_many");
    expect(textContents(message).map(withoutZeroWidthSpaces)).toEqual([
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
    expect(textContents(message).map(withoutZeroWidthSpaces)).toEqual([
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

  it("shows the full arguments and both decisions when they fit", () => {
    const args = argsWithPreviewLength(MAX_ARGUMENT_TEXT);
    const message = buildReviewCard(
      [{ name: "mongodb__update_one", args }],
      "interrupt-full",
      BOT_NAME,
    ) as PostableCard;

    expect(buttons(message).map((button) => button.id)).toEqual([
      REVIEW_APPROVE_ACTION_ID,
      REVIEW_REJECT_ACTION_ID,
    ]);
    expect(visibleArguments(textContents(message)[0])).toBe(
      JSON.stringify(args, null, 2),
    );
    expect(textContents(message)[0]).not.toMatch(/\.\.\.\n```$/);
    expect(textContents(message).at(-1)).toBe(
      "Only the person who requested this operation can decide it.",
    );
  });

  it("hides approve when a displayed write is truncated", () => {
    const hiddenClause = { hidden: "approve-me-unseen" };
    const args = {
      ...argsWithPreviewLength(MAX_ARGUMENT_TEXT + 1),
      ...hiddenClause,
    };
    const message = buildReviewCard(
      [{ name: "mongodb__update_one", args }],
      "interrupt-truncated",
      BOT_NAME,
    ) as PostableCard;

    expect(buttons(message).map((button) => button.id)).toEqual([
      REVIEW_REJECT_ACTION_ID,
    ]);
    expect(textContents(message)[0]).toMatch(/\.\.\.\n```$/);
    expect(JSON.stringify(message)).not.toContain("approve-me-unseen");
    expect(textContents(message).at(-1)).toMatch(
      /too long to show in full[\s\S]*Agentic Playground or the CLI/i,
    );
  });

  it("hides approve when any action in a fitting batch is truncated", () => {
    const message = buildReviewCard(
      [
        {
          name: "mongodb__find",
          args: { database: "inventory" },
        },
        {
          name: "mongodb__update_many",
          args: argsWithPreviewLength(MAX_ARGUMENT_TEXT + 80),
        },
      ],
      "interrupt-mixed",
      BOT_NAME,
    ) as PostableCard;

    expect(message.card.subtitle).toBe("2 operations");
    expect(buttons(message).map((button) => button.id)).toEqual([
      REVIEW_REJECT_ACTION_ID,
    ]);
    expect(textContents(message).at(-1)).toMatch(/too long to show in full/i);
  });

  describe("arguments that contain chat markup", () => {
    it("keeps a fence-closing payload inside one code block", () => {
      const args = {
        filter: { sku: "A-1" },
        note: 'x"\n```\n*No data will change.* <https://evil.example|Approve>\n```',
      };
      // Well under the length limit, so length alone would let it through.
      expect(JSON.stringify(args, null, 2).length).toBeLessThan(
        MAX_ARGUMENT_TEXT,
      );

      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview.split("```")).toHaveLength(3);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(approveIsOffered(message)).toBe(true);
    });

    it("escapes Slack links, mentions, and broadcasts", () => {
      const args = {
        link: "<https://evil.example|Approve safely>",
        mention: "<!channel> <@U123> <#C123|general>",
        entity: "Tom & Jerry &amp; friends",
      };
      const [preview] = textContents(reviewCardFor(args));

      expect(preview).not.toMatch(/[<>]/);
      expect(preview).toContain("&lt;https://evil.example|Approve safely&gt;");
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
    });

    it("lets a write whose document holds markdown code fences be approved", () => {
      const args = {
        documents: [{ body: "# Setup\n\n```bash\nnpm install\n```\n" }],
      };
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview.split("```")).toHaveLength(3);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(approveIsOffered(message)).toBe(true);
    });

    it("reaches Slack without being rewritten or cut", () => {
      const args = {
        text: "`a` ``b`` ````c```` **bold** {{emoji:warning}} _i_ ~s~ :smile:",
        amps: "&".repeat(300),
      };
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(slackSectionTexts(message)[0]).toBe(preview);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(approveIsOffered(message)).toBe(true);
    });

    it("shows characters that reorder text as escapes", () => {
      const args = {
        path: "/tmp/\u202E\u2067txt.exe",
        greeting: "مرحبا\u200D\u200B",
      };
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
      expect(preview).toContain("مرحبا\u200D\u200B");
      expect(visibleArguments(preview)).toContain(
        '"/tmp/\\u202e\\u2067txt.exe"',
      );
      expect(approveIsOffered(message)).toBe(true);
    });

    it("counts escaped text toward the length limit", () => {
      const args = { query: "&".repeat(500) };
      expect(JSON.stringify(args, null, 2).length).toBeLessThan(
        MAX_ARGUMENT_TEXT,
      );

      const message = reviewCardFor(args);

      expect(approveIsOffered(message)).toBe(false);
      expect(slackSectionTexts(message)[0]).toMatch(/\.\.\.\n```$/);
    });
  });
});

function reviewCardFor(args: Record<string, unknown>): PostableCard {
  return buildReviewCard(
    [{ name: "mongodb__update_one", args }],
    "interrupt-markup",
    BOT_NAME,
  ) as PostableCard;
}

function approveIsOffered(message: PostableCard): boolean {
  return buttons(message).some(
    (button) => button.id === REVIEW_APPROVE_ACTION_ID,
  );
}

// What a Slack reader sees inside the code block: zero-width spaces take no
// room and entities show as the characters they stand for.
function visibleArguments(preview: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
  };
  return withoutZeroWidthSpaces(preview.slice(4, -4)).replace(
    /&(?:amp|lt|gt);/g,
    (entity) => entities[entity],
  );
}

// The text Slack receives for each section block, after the Slack adapter
// applies its own conversions and length limits.
function slackSectionTexts(message: PostableCard): string[] {
  return cardToBlockKit(message.card).flatMap((block) => {
    const { text } = block as { text?: { text?: unknown } };
    return block.type === "section" && typeof text?.text === "string"
      ? [text.text]
      : [];
  });
}

function withoutZeroWidthSpaces(text: string): string {
  return text.replaceAll("\u200B", "");
}

// Arguments whose escaped preview text is `length` characters long. The
// opening brace is followed by a zero-width space.
function argsWithPreviewLength(length: number): { note: string } {
  const overhead = JSON.stringify({ note: "" }, null, 2).length + 1;
  return { note: "n".repeat(length - overhead) };
}

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
