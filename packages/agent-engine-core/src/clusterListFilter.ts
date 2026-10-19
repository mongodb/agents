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

import type { DataAccessConfig } from "./dataAccess.js";

export const PARTIAL_LIST_NOTE =
  "Results are limited to the configured allowlist.";

export const LIST_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__atlas_list_clusters",
  "mongodb__atlas_list_projects",
]);

// The Atlas MCP warning prose also names the tags ("between the <tag> and
// </tag> tags"), so only a span holding JSON is the payload.
const DATA_BLOCK =
  /(<untrusted-user-data-([\w-]+)>)([\s\S]*?)(<\/untrusted-user-data-\2>)/g;
const FOUND_HEADER = /Found \d+ (clusters?|projects?)\b/;
const NO_RESULTS = /\bNo (clusters|projects) found\b/i;

/**
 * Filters `list_clusters` or `list_projects` tool content to `dataAccess`.
 * Accepts the JSON result object Agent Engine serializes into the tool
 * message, or plain text. Returns `undefined` for any other shape so the
 * caller can withhold the result.
 */
export function filterListContent(
  toolName: string,
  resolved: DataAccessConfig,
  projectId: string | undefined,
  content: string,
): string | undefined {
  const envelope = parseResultObject(content);
  if (!envelope) {
    return filterTexts(toolName, resolved, projectId, [content])?.[0];
  }

  const blocks: Record<string, unknown>[] = [];
  const texts: string[] = [];
  for (const block of envelope.content) {
    if (!isRecord(block) || block.type !== "text") return undefined;
    if (typeof block.text !== "string") return undefined;
    blocks.push(block);
    texts.push(block.text);
  }
  const filtered = filterTexts(toolName, resolved, projectId, texts);
  if (!filtered) return undefined;
  if (filtered === texts) return content;
  return JSON.stringify({
    ...envelope,
    content: blocks.map((block, i) => ({ ...block, text: filtered[i] })),
  });
}

function parseResultObject(
  content: string,
): { content: unknown[] } | undefined {
  if (!content.trimStart().startsWith("{")) return undefined;
  try {
    const value: unknown = JSON.parse(content);
    return isRecord(value) && Array.isArray(value.content)
      ? (value as { content: unknown[] })
      : undefined;
  } catch {
    return undefined;
  }
}

function filterTexts(
  toolName: string,
  resolved: DataAccessConfig,
  projectId: string | undefined,
  texts: string[],
): string[] | undefined {
  for (const [i, text] of texts.entries()) {
    const block = findDataBlock(text);
    if (!block) continue;

    const [whole, open, , inner, close] = block;
    const payload = inner!.trim();
    const filtered = filterPayload(toolName, resolved, projectId, payload);
    if (!filtered) return undefined;
    if (!filtered.removed) return texts;

    const next = [...texts];
    const start = block.index!;
    next[i] =
      text.slice(0, start) +
      open +
      inner!.replace(payload, filtered.json) +
      close +
      text.slice(start + whole.length) +
      `\n\n${PARTIAL_LIST_NOTE}`;
    const header = next.findIndex((t) => FOUND_HEADER.test(t));
    if (header >= 0) {
      next[header] = next[header]!.replace(FOUND_HEADER, (_match, noun) =>
        `Found ${filtered.remaining} ${pluralize(noun, filtered.remaining)}`,
      );
    }
    return next;
  }
  return texts.some((t) => NO_RESULTS.test(t)) ? texts : undefined;
}

function findDataBlock(text: string): RegExpExecArray | undefined {
  for (const match of text.matchAll(DATA_BLOCK)) {
    const inner = match[3]!.trim();
    if (inner.startsWith("{") || inner.startsWith("[")) return match;
  }
  return undefined;
}

function filterPayload(
  toolName: string,
  resolved: DataAccessConfig,
  projectId: string | undefined,
  json: string,
): { json: string; removed: boolean; remaining: number } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const indent = json.includes("\n") ? 2 : undefined;

  if (toolName === "mongodb__atlas_list_clusters") {
    if (!projectId || !Object.hasOwn(resolved, projectId)) return undefined;
    if (!isRecord(parsed) || !Array.isArray(parsed.clusters)) return undefined;
    const clusters: unknown[] = parsed.clusters;
    if (!clusters.every((c) => isRecord(c) && typeof c.name === "string")) {
      return undefined;
    }
    const allowed = resolved[projectId]!.clusterNames;
    const kept = clusters.filter(
      (c) => allowed === undefined || allowed.includes((c as { name: string }).name),
    );
    return {
      json: JSON.stringify({ ...parsed, clusters: kept }, null, indent),
      removed: kept.length < clusters.length,
      remaining: kept.length,
    };
  }

  if (!Array.isArray(parsed)) return undefined;
  const projects: unknown[] = parsed;
  if (!projects.every((p) => isRecord(p) && typeof p.id === "string")) {
    return undefined;
  }
  const kept = projects.filter((p) =>
    Object.hasOwn(resolved, (p as { id: string }).id),
  );
  return {
    json: JSON.stringify(kept, null, indent),
    removed: kept.length < projects.length,
    remaining: kept.length,
  };
}

function pluralize(noun: string, count: number): string {
  const singular = noun.replace(/s$/, "");
  return count === 1 ? singular : `${singular}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
