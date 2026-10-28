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

import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import {
  LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
  SEARCH_KNOWLEDGE_TOOL_NAME,
} from "@repo/agent-engine-core";
import { parse } from "yaml";
import { z } from "zod";

import { contentToText } from "./convertLangchainMessagesToAssistantEvalMessages.js";

/**
 * `search_knowledge` returns text: a description, then a YAML list of results
 * inside `<untrusted-user-data-UUID>` tags. The warning text around the block
 * names the tags mid-line, so only tags on a line of their own count.
 */
const RESULTS_BLOCK =
  /^<untrusted-user-data-([\w-]+)>\n([\s\S]*?)\n<\/untrusted-user-data-\1>$/m;

/** One result in the block. A result without a usable URL is skipped. */
const SearchResultSchema = z.looseObject({ url: z.string().min(1).optional() });

function urlsInSearchResult(text: string): string[] {
  const block = RESULTS_BLOCK.exec(text)?.[2];
  if (!block) return [];
  let results: unknown;
  try {
    results = parse(block);
  } catch {
    return [];
  }
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) => {
    const parsed = SearchResultSchema.safeParse(result);
    return parsed.success && parsed.data.url ? [parsed.data.url] : [];
  });
}

/**
 * Source URLs the agent's `search_knowledge` calls returned, in the order
 * returned, with repeats across calls dropped. The `BinaryNdcgAt5` scorer
 * ranks these against a case's expected links.
 */
export function knowledgeSourceUrls(messages: readonly BaseMessage[]): string[] {
  const seen = new Set<string>();
  for (const message of messages) {
    if (
      !ToolMessage.isInstance(message) ||
      message.name !== SEARCH_KNOWLEDGE_TOOL_NAME ||
      message.status === "error"
    ) {
      continue;
    }
    for (const url of urlsInSearchResult(contentToText(message.content))) {
      seen.add(url);
    }
  }
  return [...seen];
}

/** A knowledge tool call that failed, and what it said. */
export interface KnowledgeToolError {
  readonly tool: string;
  readonly message: string;
}

/**
 * The knowledge tool calls that failed. A run whose searches failed scores
 * low for infrastructure reasons, and these messages say why.
 */
export function knowledgeToolErrors(
  messages: readonly BaseMessage[],
): KnowledgeToolError[] {
  return messages.flatMap((message) => {
    if (
      !ToolMessage.isInstance(message) ||
      message.status !== "error" ||
      (message.name !== SEARCH_KNOWLEDGE_TOOL_NAME &&
        message.name !== LIST_KNOWLEDGE_SOURCES_TOOL_NAME)
    ) {
      return [];
    }
    return [{ tool: message.name, message: contentToText(message.content) }];
  });
}
