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

import type { ActionsElement, PostableCard, TextElement } from "chat";
import { describe, expect, it, vi } from "vitest";

import {
  buildReviewCard,
  REVIEW_APPROVE_ACTION_ID,
  REVIEW_REJECT_ACTION_ID,
} from "./cards.js";

// The card checks that the text it sends reads as the arguments it stands for.
// This encoder is broken on purpose: it silently drops every `<`.
vi.mock("./chatLiteral.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chatLiteral.js")>();
  return {
    ...actual,
    toChatLiteral: (text: string) =>
      actual.toChatLiteral(text).replaceAll("&lt;", ""),
  };
});

describe("buildReviewCard when the preview does not read as the arguments", () => {
  it("offers only reject and says why", () => {
    const message = buildReviewCard(
      [{ name: "mongodb__update_one", args: { filter: "a < b" } }],
      "interrupt-lossy",
      "TestBot",
    ) as PostableCard;

    expect(buttonIds(message)).toEqual([REVIEW_REJECT_ACTION_ID]);
    expect(textContents(message).at(-1)).toMatch(
      /could not show some arguments exactly[\s\S]*Agentic Playground or the CLI/i,
    );
  });

  it("offers only reject when one action in a batch is not exact", () => {
    const message = buildReviewCard(
      [
        { name: "mongodb__find", args: { database: "inventory" } },
        { name: "mongodb__update_many", args: { filter: "a < b" } },
      ],
      "interrupt-lossy-batch",
      "TestBot",
    ) as PostableCard;

    expect(buttonIds(message)).toEqual([REVIEW_REJECT_ACTION_ID]);
  });

  it("still offers approve when the preview does read as the arguments", () => {
    const message = buildReviewCard(
      [{ name: "mongodb__update_one", args: { filter: "a b" } }],
      "interrupt-exact",
      "TestBot",
    ) as PostableCard;

    expect(buttonIds(message)).toEqual([
      REVIEW_APPROVE_ACTION_ID,
      REVIEW_REJECT_ACTION_ID,
    ]);
  });
});

function buttonIds(message: PostableCard): string[] {
  return message.card.children
    .filter((child): child is ActionsElement => child.type === "actions")
    .flatMap((actions) => actions.children)
    .flatMap((child) => (child.type === "button" ? [child.id] : []));
}

function textContents(message: PostableCard): string[] {
  return message.card.children
    .filter((child): child is TextElement => child.type === "text")
    .map((child) => child.content);
}
