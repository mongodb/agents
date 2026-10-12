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
  fromChatLiteral,
  revealInvisibleCharacters,
  toChatLiteral,
  withoutPartialEntity,
} from "./chatLiteral.js";

// Pieces that the encoding has to handle on their own and next to each other.
const TOKENS = [
  "`",
  "*",
  "{",
  "{emoji:",
  "&",
  "<",
  ">",
  "&amp;",
  "&lt;",
  ";",
  "\u200b",
  "x",
];

const MAX_SEQUENCE_LENGTH = 4;

describe("toChatLiteral and fromChatLiteral", () => {
  it("round-trips every short sequence of the troublesome pieces", () => {
    let checked = 0;
    for (const text of sequencesOf(TOKENS, MAX_SEQUENCE_LENGTH)) {
      const revealed = revealInvisibleCharacters(text);

      expect(fromChatLiteral(toChatLiteral(revealed))).toBe(revealed);
      checked += 1;
    }
    // 12 pieces, every sequence of 0 to 4 of them.
    expect(checked).toBe(
      (TOKENS.length ** (MAX_SEQUENCE_LENGTH + 1) - 1) / (TOKENS.length - 1),
    );
  });

  it("leaves nothing the chat SDK or Slack would act on", () => {
    for (const text of sequencesOf(TOKENS, MAX_SEQUENCE_LENGTH)) {
      const literal = toChatLiteral(revealInvisibleCharacters(text));

      expect(literal).not.toMatch(/[<>]/);
      expect(literal).not.toContain("``");
      expect(literal).not.toContain("**");
      expect(literal).not.toMatch(/\{\{emoji:/i);
      // Every `&` starts one of the three entities.
      expect(literal.replace(/&(?:amp|lt|gt);/g, "")).not.toContain("&");
    }
  });

  it("does not round-trip a zero-width space it did not add", () => {
    // This is why invisible characters are revealed first: a preview that
    // hid one would not read as the text it stands for.
    const text = "a\u200bb";

    expect(fromChatLiteral(toChatLiteral(text))).not.toBe(text);
    expect(fromChatLiteral(toChatLiteral(revealInvisibleCharacters(text)))).toBe(
      "a\\u200bb",
    );
  });

  it("changes only what it has to", () => {
    expect(toChatLiteral("plain `code` and *one* {braces}")).toBe(
      "plain `code` and *one* {braces}",
    );
    expect(toChatLiteral("a < b > c & d")).toBe("a &lt; b &gt; c &amp; d");
    expect(toChatLiteral("``")).toBe("`\u200b`");
    expect(toChatLiteral("```")).toBe("`\u200b`\u200b`");
    expect(toChatLiteral("**x**")).toBe("*\u200b*x*\u200b*");
    expect(toChatLiteral("{{emoji:ok}}")).toBe("{\u200b{emoji:ok}}");
  });

  it("decodes an entity only once", () => {
    expect(fromChatLiteral("&amp;lt;")).toBe("&lt;");
  });
});

describe("revealInvisibleCharacters", () => {
  it("escapes zero-width, bidirectional, tag, and control characters", () => {
    expect(revealInvisibleCharacters("a\u200bb\u202ec\u0085d\u2028e")).toBe(
      "a\\u200bb\\u202ec\\u0085d\\u2028e",
    );
    expect(revealInvisibleCharacters("\u{E0041}")).toBe("\\udb40\\udc41");
  });

  it("keeps newlines, visible text, and emoji", () => {
    expect(revealInvisibleCharacters('{\n  "a": "héllo 🎉"\n}')).toBe(
      '{\n  "a": "héllo 🎉"\n}',
    );
  });
});

describe("withoutPartialEntity", () => {
  it.each([
    ["a &amp", "a "],
    ["a &am", "a "],
    ["a &", "a "],
    ["a &amp;", "a &amp;"],
    ["a &amp; b &l", "a &amp; b "],
    ["no entities", "no entities"],
    ["a &amp; b; c", "a &amp; b; c"],
  ])("cuts %j to %j", (literal, expected) => {
    expect(withoutPartialEntity(literal)).toBe(expected);
  });
});

function* sequencesOf(
  tokens: string[],
  maxLength: number,
  prefix = "",
  depth = 0,
): Generator<string> {
  yield prefix;
  if (depth === maxLength) {
    return;
  }
  for (const token of tokens) {
    yield* sequencesOf(tokens, maxLength, prefix + token, depth + 1);
  }
}
