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

import { stringify, Document } from "yaml";
import { z } from "zod";

/**
 * Cases in `mongodb/ai-assistant` `evalCases/*.yml`, which the agents' eval
 * format is adapted from. Only the fields the port reads are described.
 */
const SourceCaseSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  input: z.looseObject({
    messages: z.array(z.looseObject({ role: z.string(), content: z.string() })),
  }),
  expected: z
    .looseObject({
      referenceAnswer: z.string().optional(),
      links: z.array(z.string()).optional(),
      outputMessages: z
        .array(
          z.looseObject({
            role: z.string(),
            toolCalls: z.array(z.looseObject({ name: z.string() })).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/**
 * Tools the source cases name that the agents expose under another name.
 * A source tool that is not here needs a hand port.
 */
export const SOURCE_TOOL_RENAMES: Readonly<Record<string, string>> = {
  legacy_content_search: "search_knowledge",
};

const SEARCH_KNOWLEDGE = "search_knowledge";

export interface PortedKnowledgeCase {
  name: string;
  description?: string;
  tags?: string[];
  input: { messages: { role: "user"; content: string }[] };
  expected: {
    referenceAnswer: string;
    links?: string[];
    outputMessages: unknown[];
  };
}

/**
 * Turns one ai-assistant knowledge case into an eval case for the agents.
 *
 * - The case needs one user message and a reference answer.
 * - The agent must call `search_knowledge`, so the case always expects that
 *   call. The source's tool arguments are dropped: its `version` argument has
 *   no counterpart (the agents' tool takes a data source name and version
 *   label) and the trajectory scorer only needs the call.
 * - Fields the agents' suites do not score are dropped: `ci`, `promptAdherence`,
 *   `verifiedAnswer`, `promotions` and the rest.
 *
 * It throws on a case it cannot port faithfully, so a hand-picked list fails
 * loudly instead of changing meaning.
 */
export function portKnowledgeCase(source: unknown): PortedKnowledgeCase {
  const parsed = SourceCaseSchema.parse(source);
  const label = `"${parsed.name}"`;

  const { messages } = parsed.input;
  if (messages.length !== 1 || messages[0].role !== "user") {
    throw new Error(`${label}: only single-message conversations can be ported`);
  }
  const referenceAnswer = parsed.expected?.referenceAnswer?.trim();
  if (!referenceAnswer) {
    throw new Error(`${label}: has no referenceAnswer to grade against`);
  }

  for (const message of parsed.expected?.outputMessages ?? []) {
    for (const call of message.toolCalls ?? []) {
      if (SOURCE_TOOL_RENAMES[call.name] !== SEARCH_KNOWLEDGE) {
        throw new Error(
          `${label}: expects tool "${call.name}", which needs a hand port`,
        );
      }
    }
  }

  const links = parsed.expected?.links;
  return {
    name: parsed.name,
    ...(parsed.description !== undefined && {
      description: parsed.description.trim(),
    }),
    ...(parsed.tags && { tags: parsed.tags }),
    input: { messages: [{ role: "user", content: messages[0].content }] },
    expected: {
      referenceAnswer,
      ...(links?.length && { links }),
      outputMessages: [
        { role: "user" },
        { role: "assistant-tool", toolCalls: [{ name: SEARCH_KNOWLEDGE }] },
        { role: "tool" },
        { role: "assistant" },
      ],
    },
  };
}

export interface PortedCaseWithSource {
  /** Source file name, for the provenance comment. */
  readonly file: string;
  /** The case's name in the source, when `case.name` was changed. */
  readonly sourceName?: string;
  readonly case: { readonly name: string };
}

/**
 * Renders ported cases as a YAML dataset. `header` becomes the opening
 * comment, and each case gets a comment naming its source file and case.
 */
export function renderPortedCases(
  cases: readonly PortedCaseWithSource[],
  header: string,
): string {
  const doc = new Document(cases.map((c) => c.case));
  doc.commentBefore = header
    .split("\n")
    .map((line) => ` ${line}`.trimEnd())
    .join("\n");
  cases.forEach((c, i) => {
    const item = (doc.contents as { items: { commentBefore?: string }[] })
      .items[i];
    item.commentBefore = ` Source: ${c.file}, "${c.sourceName ?? c.case.name}"`;
  });
  return stringify(doc, { lineWidth: 80 });
}
