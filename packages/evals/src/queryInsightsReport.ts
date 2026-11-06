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

/** One `### Shape <n>: <command> on <namespace>` section of a report. */
export interface ReportSection {
  readonly rank: number;
  readonly command: string;
  readonly namespace: string;
  /** Everything under the heading, up to the next shape heading. */
  readonly body: string;
  /** The body before "Areas worth investigating", or all of it. */
  readonly overview: string;
  /**
   * Each numbered item under "Areas worth investigating", code blocks
   * removed. Empty when the section has no such list.
   */
  readonly areas: readonly string[];
  readonly hasAreasHeading: boolean;
}

export interface QueryInsightsReport {
  /** Text before the first shape heading. */
  readonly summary: string;
  readonly sections: readonly ReportSection[];
}

const SHAPE_HEADING = /^###\s+Shape\s+(\d+):\s*(.+?)\s+on\s+(.+?)\s*$/gm;
const AREAS_HEADING = /areas worth investigating/i;
const NUMBERED_ITEM = /^\s{0,3}\d+[.)]\s+/;
const FENCED_BLOCK = /```[\s\S]*?(```|$)/g;
const CREATE_INDEX_CALL = /createIndex\s*\(\s*(?:\{([^}]*)\})?/g;
const INDEX_KEY = /^\s*(?:"([^"]+)"|'([^']+)'|([\w.$]+))\s*:\s*(-?\d+|"[^"]*"|'[^']*')\s*$/;

function unquote(text: string): string {
  return text.replace(/[`*]/g, "").trim();
}

function areasOf(body: string): { hasAreasHeading: boolean; areas: string[] } {
  const start = body.search(AREAS_HEADING);
  if (start === -1) return { hasAreasHeading: false, areas: [] };
  const lines = body
    .slice(start)
    .replace(FENCED_BLOCK, "")
    .split("\n")
    .slice(1);
  const areas: string[] = [];
  for (const line of lines) {
    if (NUMBERED_ITEM.test(line)) areas.push(line.replace(NUMBERED_ITEM, ""));
    else if (areas.length && line.trim()) areas[areas.length - 1] += `\n${line}`;
  }
  return { hasAreasHeading: true, areas: areas.map((a) => a.trim()) };
}

/**
 * Splits a Query Insights report into its summary and shape sections, in the
 * layout the agent's prompt asks for. It never throws: a report that does not
 * follow the layout parses to fewer sections, which the scorers count as
 * failed checks.
 */
export function parseQueryInsightsReport(text: string): QueryInsightsReport {
  const headings = [...text.matchAll(SHAPE_HEADING)];
  const sections = headings.map((heading, i) => {
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[i + 1]?.index ?? text.length;
    const body = text.slice(bodyStart, bodyEnd);
    return {
      rank: Number(heading[1]),
      command: unquote(heading[2]),
      namespace: unquote(heading[3]),
      body,
      overview: body.split(AREAS_HEADING)[0],
      ...areasOf(body),
    };
  });
  return {
    summary: text.slice(0, headings[0]?.index ?? text.length).trim(),
    sections,
  };
}

/**
 * The keys of each `createIndex(...)` call in `text`, in order, as
 * `[{ field: direction }]` entries. A call whose keys cannot be read gives an
 * empty list.
 */
export function createIndexKeys(text: string): Record<string, number | string>[][] {
  return [...text.matchAll(CREATE_INDEX_CALL)].map(([, document]) =>
    document === undefined ? [] : keysOf(document),
  );
}

function keysOf(document: string): Record<string, number | string>[] {
  const keys: Record<string, number | string>[] = [];
  for (const entry of document.split(",").filter((e) => e.trim())) {
    const match = INDEX_KEY.exec(entry);
    if (!match) return [];
    const [, doubleQuoted, singleQuoted, bare, direction] = match;
    keys.push({
      [doubleQuoted ?? singleQuoted ?? bare]: /^-?\d+$/.test(direction)
        ? Number(direction)
        : direction.slice(1, -1),
    });
  }
  return keys;
}
