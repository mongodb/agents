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

import { z } from "zod";

import {
  agentToolName,
  MANAGED_MCP_TOOLS,
} from "../mcp/managedTools.js";

/**
 * The fixture every ported database tool case reads. Source cases use the
 * `sample_mflix` database, and `fixtures/mongo/sample-mflix.yml` is its seed.
 */
export const DB_TOOLS_FIXTURE = "sample-mflix";

/** Tag the source file puts on every case. It says nothing about the case. */
const SOURCE_BOOKKEEPING_TAG = "mcp_db_read_only";

const SourceToolCallSchema = z.looseObject({
  name: z.string(),
  arguments: z.array(z.looseObject({ name: z.string() })).optional(),
});

/** Cases in `evalCases/mongodb_mcp_tools_db_read_only.yml` of ai-assistant. */
const SourceDbToolCaseSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  input: z.looseObject({
    messages: z.array(z.looseObject({ role: z.string(), content: z.string() })),
    custom: z
      .looseObject({
        customData: z
          .object({
            databaseName: z.string().optional(),
            collectionName: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .optional(),
  }),
  expected: z
    .looseObject({
      outputMessages: z
        .array(
          z.looseObject({
            role: z.string(),
            toolCalls: z.array(SourceToolCallSchema).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export interface PortedDbToolCase {
  name: string;
  description?: string;
  tags?: string[];
  input: {
    messages: { role: "user"; content: string }[];
    custom: {
      defaultData?: { databaseName?: string; collectionName?: string };
      toolSetup: { localMongo: string };
    };
  };
  expected: { outputMessages: unknown[] };
}

/**
 * Turns one ai-assistant database tool case into an eval case for Atlas
 * Explorer, in read-only mode.
 *
 * - Tool names become the names the agent sees: `list-databases` is
 *   `mongodb__list_databases`. Expected arguments are kept as written. The
 *   library matches them as a subset, so extra arguments the model passes
 *   (such as `connectionId`) are fine.
 * - `custom.customData` becomes the agent's `defaultData`.
 * - The case reads the `sample-mflix` fixture.
 *
 * The case must expect at least one tool call. Cases that expect none (the
 * write refusals) are written by hand, because each runs in several modes.
 * It throws on anything it cannot port faithfully, so a hand-picked list
 * fails loudly instead of changing meaning.
 */
export function portDbToolCase(source: unknown): PortedDbToolCase {
  const parsed = SourceDbToolCaseSchema.parse(source);
  const label = `"${parsed.name}"`;

  const { messages, custom } = parsed.input;
  if (messages.length !== 1 || messages[0].role !== "user") {
    throw new Error(`${label}: only single-message conversations can be ported`);
  }
  const unsupported = Object.keys(custom ?? {}).filter(
    (key) => key !== "customData",
  );
  if (unsupported.length) {
    throw new Error(
      `${label}: input.custom.${unsupported.join(", ")} has no counterpart in the agents`,
    );
  }

  const toolMessages = (parsed.expected?.outputMessages ?? []).filter(
    (message) => message.role === "assistant-tool",
  );
  if (!toolMessages.length) {
    throw new Error(`${label}: expects no tool call, which needs a hand port`);
  }
  const renamed = toolMessages.map((message) => ({
    role: "assistant-tool" as const,
    toolCalls: (message.toolCalls ?? []).map(({ name, ...rest }) => {
      if (!MANAGED_MCP_TOOLS.includes(name)) {
        throw new Error(
          `${label}: expects tool "${name}", which needs a hand port`,
        );
      }
      return { name: agentToolName(name), ...rest };
    }),
  }));

  const tags = parsed.tags?.filter((tag) => tag !== SOURCE_BOOKKEEPING_TAG);
  const defaultData = custom?.customData;
  return {
    name: parsed.name,
    ...(parsed.description !== undefined && {
      description: parsed.description.trim(),
    }),
    ...(tags?.length && { tags }),
    input: {
      messages: [{ role: "user", content: messages[0].content }],
      custom: {
        ...(defaultData && Object.keys(defaultData).length && { defaultData }),
        toolSetup: { localMongo: DB_TOOLS_FIXTURE },
      },
    },
    expected: {
      outputMessages: [
        { role: "user" },
        ...renamed.flatMap((message) => [message, { role: "tool" }]),
        { role: "assistant" },
      ],
    },
  };
}
