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
const FENCE = "```";

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

  it("shows the full arguments and both decisions when they fit", () => {
    const args = argsWithJsonLength(MAX_ARGUMENT_TEXT);
    const message = buildReviewCard(
      [{ name: "mongodb__update_one", args }],
      "interrupt-full",
      BOT_NAME,
    ) as PostableCard;

    expect(buttons(message).map((button) => button.id)).toEqual([
      REVIEW_APPROVE_ACTION_ID,
      REVIEW_REJECT_ACTION_ID,
    ]);
    expect(textContents(message)[0]).toContain(JSON.stringify(args, null, 2));
    expect(textContents(message)[0]).not.toMatch(/\.\.\.\n```$/);
    expect(textContents(message).at(-1)).toBe(
      "Only the person who requested this operation can decide it.",
    );
  });

  it("hides approve when a displayed write is truncated", () => {
    const hiddenClause = { hidden: "approve-me-unseen" };
    const args = {
      ...argsWithJsonLength(MAX_ARGUMENT_TEXT + 1),
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
          args: argsWithJsonLength(MAX_ARGUMENT_TEXT + 80),
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

  describe("argument markup injection", () => {
    it("keeps a fence-closing payload inside one code block and shows the real arguments", () => {
      const args = {
        filter: { sku: "A-1" },
        note: 'x"\n```\n*No data will change.* <https://evil.example|Approve to stay safe>\n```json\n{"',
      };
      // The payload is far below the length limit, so length alone would
      // have called this preview complete.
      expect(JSON.stringify(args, null, 2).length).toBeLessThan(
        MAX_ARGUMENT_TEXT,
      );

      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview.split(FENCE)).toHaveLength(3);
      expect(preview.startsWith(`${FENCE}\n`)).toBe(true);
      expect(preview.endsWith(`\n${FENCE}`)).toBe(true);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(approveIsOffered(message)).toBe(true);
    });

    it.each([
      ["a double backtick", "``"],
      ["a triple backtick", "```"],
      ["a four-backtick run", "````"],
      ["a long backtick run", "`".repeat(25)],
    ])("shows %s in an argument without closing the fence", (_name, run) => {
      const args = { note: `before ${run} after` };
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(fenceBody(preview)).not.toContain("``");
      expect(preview.split(FENCE)).toHaveLength(3);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(approveIsOffered(message)).toBe(true);
    });

    it("lets a write whose document holds markdown code fences be approved", () => {
      const args = {
        database: "docs",
        collection: "pages",
        documents: [
          { title: "Setup", body: "# Setup\n\n```bash\nnpm install\n```\n" },
        ],
      };
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview.split(FENCE)).toHaveLength(3);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(buttons(message).map((button) => button.id)).toEqual([
        REVIEW_APPROVE_ACTION_ID,
        REVIEW_REJECT_ACTION_ID,
      ]);
      expect(textContents(message).at(-1)).toBe(
        "Only the person who requested this operation can decide it.",
      );
    });

    it("keeps a single backtick as it is", () => {
      const message = reviewCardFor({ note: "use `sku` here" });

      expect(textContents(message)[0]).toContain("use `sku` here");
      expect(approveIsOffered(message)).toBe(true);
    });

    it("escapes Slack links, mentions, and entities as literal text", () => {
      const args = {
        link: "<https://evil.example|Approve safely>",
        broadcast: "<!channel> <!here>",
        mention: "<@U123> <#C123|general>",
        entity: "Tom & Jerry &amp; friends",
      };
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview).toContain("&lt;https://evil.example|Approve safely&gt;");
      expect(preview).toContain("&lt;!channel&gt; &lt;!here&gt;");
      expect(preview).toContain("&lt;@U123&gt; &lt;#C123|general&gt;");
      expect(preview).toContain("Tom &amp; Jerry &amp;amp; friends");
      expect(preview).not.toMatch(/[<>]/);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(approveIsOffered(message)).toBe(true);
    });

    it.each([
      ["bold markers", { pattern: "**all**" }],
      ["emoji placeholders", { note: "{{emoji:white_check_mark}}" }],
      ["both", { note: "**{{emoji:warning}}** done" }],
    ])("keeps %s from being rewritten by the chat SDK", (_name, args) => {
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview).not.toContain("**");
      expect(preview).not.toContain("{{emoji:");
      // Nothing is left for the Slack adapter to rewrite.
      expect(slackSectionTexts(message)[0]).toBe(preview);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(approveIsOffered(message)).toBe(true);
    });

    it("reaches Slack exactly as built for text that looks like mrkdwn", () => {
      const args = {
        text: "*bold* _italic_ ~strike~ > quote :smile: `code` ``two`` ```three```",
        links: "https://example.com a@example.com #general @here <@U1> <!channel>",
        unsafe: "**x** {{emoji:x}} a < b && c > d",
        amps: "&".repeat(300),
      };
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(slackSectionTexts(message)[0]).toBe(preview);
      expect(preview.endsWith(`\n${FENCE}`)).toBe(true);
      expect(visibleArguments(preview)).toBe(JSON.stringify(args, null, 2));
      expect(approveIsOffered(message)).toBe(true);
    });

    it("shows invisible and bidirectional characters as JSON escapes", () => {
      const args = { file: "report\u202Efdp.exe\u200B", tag: "\u{E0041}" };
      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview).toContain("report\\u202efdp.exe\\u200b");
      expect(preview).toContain("\\udb40\\udc41");
      expect(preview).not.toMatch(/[\u200B\u202E]|\u{E0041}/u);
      // A zero-width space in the preview can only be one the card added.
      expect(JSON.parse(visibleArguments(preview))).toEqual(args);
      expect(approveIsOffered(message)).toBe(true);
    });

    it("counts escaping toward the length limit and never splits an entity", () => {
      const args = { query: "&".repeat(500) };
      expect(JSON.stringify(args, null, 2).length).toBeLessThan(
        MAX_ARGUMENT_TEXT,
      );

      const message = reviewCardFor(args);
      const [preview] = textContents(message);

      expect(preview.length).toBeLessThanOrEqual(
        MAX_ARGUMENT_TEXT + 2 * (FENCE.length + 1),
      );
      expect(preview).toMatch(/(?:&amp;)+\.\.\.\n```$/);
      expect(slackSectionTexts(message)[0]).toBe(preview);
      expect(approveIsOffered(message)).toBe(false);
      expect(textContents(message).at(-1)).toMatch(/too long to show in full/i);
    });

    it("still hides approve and keeps one fence when a backtick payload is truncated", () => {
      const message = reviewCardFor({ note: "`".repeat(MAX_ARGUMENT_TEXT) });
      const [preview] = textContents(message);

      expect(fenceBody(preview)).not.toContain("``");
      expect(preview.split(FENCE)).toHaveLength(3);
      expect(preview.endsWith(`...\n${FENCE}`)).toBe(true);
      expect(slackSectionTexts(message)[0]).toBe(preview);
      expect(approveIsOffered(message)).toBe(false);
    });

    it("covers every action in a batch", () => {
      const first = { database: "inventory" };
      const second = { note: "```\n*hidden*\n```" };
      const message = buildReviewCard(
        [
          { name: "mongodb__find", args: first },
          { name: "mongodb__update_many", args: second },
        ],
        "interrupt-batch",
        BOT_NAME,
      ) as PostableCard;
      const previews = textContents(message).filter((text) =>
        text.startsWith(FENCE),
      );

      expect(previews).toHaveLength(2);
      for (const preview of previews) {
        expect(preview.split(FENCE)).toHaveLength(3);
      }
      expect(previews.map(visibleArguments)).toEqual([
        JSON.stringify(first, null, 2),
        JSON.stringify(second, null, 2),
      ]);
      expect(approveIsOffered(message)).toBe(true);
    });
  });
});

function reviewCardFor(args: Record<string, unknown>): PostableCard {
  return buildReviewCard(
    [{ name: "mongodb__update_one", args }],
    "interrupt-injection",
    BOT_NAME,
  ) as PostableCard;
}

function fenceBody(preview: string): string {
  return preview.slice(FENCE.length + 1, -(FENCE.length + 1));
}

// What a Slack reader sees inside the code fence: zero-width spaces take no
// room and entities show as the characters they stand for. Written out here
// rather than imported, so the tests do not trust the code they check.
function visibleArguments(preview: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
  };
  return fenceBody(preview)
    .replaceAll("\u200B", "")
    .replace(/&(?:amp|lt|gt);/g, (entity) => entities[entity]);
}

function approveIsOffered(message: PostableCard): boolean {
  return buttons(message).some(
    (button) => button.id === REVIEW_APPROVE_ACTION_ID,
  );
}

// The text Slack receives for each section block, after the Slack adapter
// has applied its own conversions and length limits.
function slackSectionTexts(message: PostableCard): string[] {
  return cardToBlockKit(message.card).flatMap((block) => {
    const { text } = block as { text?: { text?: unknown } };
    return block.type === "section" && typeof text?.text === "string"
      ? [text.text]
      : [];
  });
}

function argsWithJsonLength(length: number): { note: string } {
  const overhead = JSON.stringify({ note: "" }, null, 2).length;
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
