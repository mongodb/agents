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

// Text that came from a tool call is attacker-influenced, and the chat SDK
// sends card text to Slack as mrkdwn. These helpers turn such text into an
// encoding that Slack shows as the same characters, and back, so a card can
// check that what it sends reads as the text it stands for.

const ZERO_WIDTH_SPACE = "\u200b";

// Zero-width, bidirectional, and other control or format characters render as
// nothing or reorder the text around them. A raw newline is JSON layout, not
// content.
const INVISIBLE_CHARACTER = /(?!\n)[\p{Cc}\p{Cf}\u2028\u2029]/gu;

// The first character of each sequence that the chat SDK or Slack acts on even
// inside a code fence. A zero-width space after it breaks the sequence without
// changing how the text reads.
//   - two backticks in a row can close the fence
//   - `**bold**` is rewritten to Slack bold
//   - `{{emoji:name}}` is rewritten to an emoji
const SEQUENCE_START = /`(?=`)|\*(?=\*)|\{(?=\{emoji:)/gi;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
};

// Shows invisible characters as `\u` escapes, which keep the same string value
// when the text is JSON. After this, any zero-width space in the text is one
// that `toChatLiteral` added.
export function revealInvisibleCharacters(text: string): string {
  return text.replace(INVISIBLE_CHARACTER, (character) =>
    Array.from(
      { length: character.length },
      (_unit, index) =>
        `\\u${character.charCodeAt(index).toString(16).padStart(4, "0")}`,
    ).join(""),
  );
}

// Escapes `&`, `<`, and `>` so Slack shows them as themselves and never as a
// link, mention, or broadcast, and breaks up the sequences listed above with
// zero-width spaces. The result is safe inside a code fence.
export function toChatLiteral(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(SEQUENCE_START, (character) => `${character}${ZERO_WIDTH_SPACE}`);
}

// The text a reader sees for a literal: the inverse of `toChatLiteral` for text
// that went through `revealInvisibleCharacters`.
export function fromChatLiteral(literal: string): string {
  return literal
    .replaceAll(ZERO_WIDTH_SPACE, "")
    .replace(/&(?:amp|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity);
}

// Drops an entity that a cut left half written, such as `&am`. Every `&` in a
// literal starts an entity, so one with no `;` after it was cut short.
export function withoutPartialEntity(literal: string): string {
  const entityStart = literal.lastIndexOf("&");
  return entityStart > literal.lastIndexOf(";")
    ? literal.slice(0, entityStart)
    : literal;
}
