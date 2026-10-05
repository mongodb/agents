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

import { ToolMessage, type MessageContent } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { display as displayQueryStat } from "./queryStatsFormatter.js";

export const PERFORMANCE_ADVISOR_TOOL = "mongodb__atlas_get_performance_advisor";
export const SLOW_QUERY_SAMPLE_LIMIT = 50;

const NO_SUGGESTION = "No PA Suggestion at this time.";

const DROPPED_COMMAND_KEYS = new Set([
  "lsid",
  "$db",
  "$clusterTime",
  "$readPreference",
  "comment",
  "maxTimeMS",
  "apiVersion",
  "apiDeprecationErrors",
  "apiStrict",
  "txnNumber",
  "startTransaction",
  "autocommit",
  "readConcern",
  "writeConcern",
  "bypassDocumentValidation",
  "$audit",
]);

interface SlowQueryLog {
  line?: unknown;
  namespace?: unknown;
}

interface SuggestedIndex {
  namespace?: unknown;
  index?: unknown;
  weight?: unknown;
  collation?: unknown;
}

interface ParsedLog {
  namespace: string;
  command: string;
  shapeKey: string;
  shapeText: string;
  docsExamined?: number;
  docsReturned?: number;
  keysExamined?: number;
  workingMillis?: number;
  execMicros?: number;
  bytesRead?: number;
  numYields?: number;
  planSummary?: string;
  timestamp?: string;
  fields: Set<string>;
}

interface ShapeGroup {
  namespace: string;
  command: string;
  shapeText: string;
  count: number;
  docsExamined?: number;
  docsReturned?: number;
  keysExamined?: number;
  workingMillis?: number;
  bytesRead?: number;
  yields: number[];
  plans: string[];
  lastMicros?: number;
  lastTimestamp?: string;
  fields: Set<string>;
}

interface ToolCallRequest {
  toolCall?: {
    name?: string;
  };
}

export function buildPerformanceAdvisorEvidence(payload: unknown): string | null {
  const body = unwrapPayload(payload);
  if (!body) return null;

  const logs = readLogs(body);
  const suggestions = readSuggestions(body);
  if (!logs || !suggestions) return null;

  const parsed: ParsedLog[] = [];
  for (const log of logs) {
    const entry = parseSlowQueryLog(log);
    if (entry) parsed.push(entry);
  }
  if (logs.length > 0 && parsed.length === 0) return null;

  const groups = [...groupLogs(parsed).values()].sort(compareImpact);
  return renderEvidence(logs.length, groups, suggestions);
}

export async function annotatePerformanceAdvisorCall<T>(
  request: ToolCallRequest,
  handler: () => T | Promise<T>,
): Promise<T | ToolMessage> {
  const result = await handler();
  if (request.toolCall?.name !== PERFORMANCE_ADVISOR_TOOL) return result;
  if (!ToolMessage.isInstance(result) || result.status === "error") return result;

  try {
    const evidence = buildPerformanceAdvisorEvidence(result.content);
    if (evidence === null) return result;
    return new ToolMessage({
      content: appendContent(result.content, evidence),
      tool_call_id: result.tool_call_id,
      name: result.name,
      status: result.status,
    });
  } catch {
    return result;
  }
}

export function annotatePerformanceAdvisorMiddleware() {
  return createMiddleware({
    name: "annotatePerformanceAdvisor",
    wrapToolCall: async (request, handler) =>
      annotatePerformanceAdvisorCall(request, () => handler(request)),
  });
}

function unwrapPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload === "string") {
    const parsed = parseJson(payload);
    if (parsed && typeof parsed === "object") {
      return unwrapPayload(parsed);
    }
    return payloadFromMarkdown(payload);
  }
  if (Array.isArray(payload)) {
    const text = payload
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          const textValue = (block as { text?: unknown }).text;
          return typeof textValue === "string" ? textValue : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return text ? unwrapPayload(text) : null;
  }
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  if (record.structuredContent && typeof record.structuredContent === "object") {
    return unwrapPayload(record.structuredContent);
  }
  if (isAdvisorBody(record)) return record;
  if ("content" in record) return unwrapPayload(record.content);
  return null;
}

function isAdvisorBody(record: Record<string, unknown>): boolean {
  return (
    Array.isArray(record.slowQueryLogs) ||
    Array.isArray(record.slowQueries) ||
    Array.isArray(record.suggestedIndexes)
  );
}

function payloadFromMarkdown(text: string): Record<string, unknown> | null {
  const slowHeading = text.includes("## Slow Query Logs");
  const suggestedHeading = text.includes("## Suggested Indexes");
  if (!slowHeading && !suggestedHeading) return null;
  const slow = slowHeading ? jsonAfterHeading(text, "## Slow Query Logs") : [];
  const suggested = suggestedHeading ? jsonAfterHeading(text, "## Suggested Indexes") : [];
  if (slow === undefined || suggested === undefined) return null;
  return {
    slowQueryLogs: Array.isArray(slow) ? slow : [],
    suggestedIndexes: Array.isArray(suggested) ? suggested : [],
  };
}

function jsonAfterHeading(text: string, heading: string): unknown {
  const start = text.indexOf(heading);
  if (start < 0) return undefined;
  const slice = text.slice(start + heading.length);
  if (/No (slow query logs|suggested indexes) found/.test(slice.slice(0, 240))) {
    return [];
  }
  const arrayAt = slice.indexOf("[");
  const objectAt = slice.indexOf("{");
  const at = arrayAt < 0 ? objectAt : objectAt < 0 ? arrayAt : Math.min(arrayAt, objectAt);
  if (at < 0) return undefined;
  return parseJsonValue(slice.slice(at));
}

function parseJsonValue(text: string): unknown {
  const opener = text[0];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opener) depth++;
    else if (char === closer) {
      depth--;
      if (depth === 0) return parseJson(text.slice(0, i + 1));
    }
  }
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readLogs(body: Record<string, unknown>): SlowQueryLog[] | null {
  const value = body.slowQueryLogs ?? body.slowQueries;
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is SlowQueryLog => !!entry && typeof entry === "object");
}

function readSuggestions(body: Record<string, unknown>): SuggestedIndex[] | null {
  const value = body.suggestedIndexes;
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is SuggestedIndex => !!entry && typeof entry === "object");
}

function parseSlowQueryLog(log: SlowQueryLog): ParsedLog | null {
  const namespaceHint = typeof log.namespace === "string" ? log.namespace : undefined;
  if (typeof log.line !== "string" || !log.line.trim()) return null;
  const trimmed = log.line.trim();
  if (trimmed.startsWith("{")) return parseStructuredLog(trimmed, namespaceHint);
  return parseLegacyLog(trimmed, namespaceHint);
}

function parseStructuredLog(line: string, namespaceHint: string | undefined): ParsedLog | null {
  const parsed = parseJson(line);
  if (!parsed || typeof parsed !== "object") return null;
  const attr = (parsed as { attr?: unknown }).attr;
  if (!attr || typeof attr !== "object") return null;
  const record = attr as Record<string, unknown>;
  const command = record.command;
  if (!command || typeof command !== "object" || Array.isArray(command)) return null;

  const shaped = shapeFromCommand(command as Record<string, unknown>);
  const namespace =
    namespaceHint ||
    (typeof record.ns === "string" ? record.ns : undefined) ||
    "unknown";
  const workingMillis = firstNumber(record, ["millis", "durationMillis", "workingMillis"]);
  return {
    namespace,
    command: shaped.name,
    shapeKey: `${namespace}\n${shaped.text}`,
    shapeText: shaped.text,
    docsExamined: firstNumber(record, ["docsExamined"]),
    docsReturned: firstNumber(record, ["nreturned", "nReturned", "docsReturned"]),
    keysExamined: firstNumber(record, ["keysExamined"]),
    workingMillis,
    execMicros:
      firstNumber(record, ["durationMicros", "workingMicros"]) ??
      (workingMillis === undefined ? undefined : workingMillis * 1000),
    bytesRead: firstNumber(record, ["bytesRead"]) ?? nestedNumber(record, ["storage", "data"], "bytesRead"),
    numYields: firstNumber(record, ["numYields"]),
    planSummary: typeof record.planSummary === "string" ? record.planSummary : undefined,
    timestamp: readTimestamp(parsed),
    fields: shaped.fields,
  };
}

function parseLegacyLog(line: string, namespaceHint: string | undefined): ParsedLog | null {
  const plan = matchOne(line, /planSummary:\s*(.+?)\s+(?:keysExamined|docsExamined|nreturned|executionTimeMillis|protocol|queryHash):/);
  const commandMatch = /command:\s+(\w+)\s+(\{.*\})\s+planSummary:/.exec(line);
  const namespace =
    namespaceHint ||
    matchOne(line, /command\s+([A-Za-z0-9_.-]+)\s+/) ||
    "unknown";
  if (!plan && !commandMatch) return null;

  const commandObject = commandMatch?.[2] ? shellToJson(commandMatch[2]) : undefined;
  const shaped =
    commandObject && typeof commandObject === "object" && !Array.isArray(commandObject)
      ? shapeFromCommand(commandObject as Record<string, unknown>)
      : {
          name: commandMatch?.[1] ?? "unknown",
          text: redactLegacySnippet(commandMatch?.[2] ?? line),
          fields: new Set<string>(),
        };
  const workingMillis = firstMatchNumber(line, /(?:executionTimeMillis|millis):(\d+(?:\.\d+)?)/);
  return {
    namespace,
    command: shaped.name,
    shapeKey: `${namespace}\n${shaped.text}`,
    shapeText: shaped.text,
    docsExamined: firstMatchNumber(line, /docsExamined:(\d+(?:\.\d+)?)/),
    docsReturned: firstMatchNumber(line, /nreturned:(\d+(?:\.\d+)?)/),
    keysExamined: firstMatchNumber(line, /keysExamined:(\d+(?:\.\d+)?)/),
    workingMillis,
    execMicros: workingMillis === undefined ? undefined : workingMillis * 1000,
    planSummary: plan,
    fields: shaped.fields,
  };
}

function shapeFromCommand(command: Record<string, unknown>): {
  name: string;
  text: string;
  fields: Set<string>;
} {
  const name =
    Object.keys(command).find((key) => !key.startsWith("$") && !DROPPED_COMMAND_KEYS.has(key)) ??
    "unknown";
  const shape: Record<string, unknown> = { command: name };
  for (const [key, value] of Object.entries(command)) {
    if (key === name || key.startsWith("$") || DROPPED_COMMAND_KEYS.has(key)) continue;
    const structural = key === "sort" || key === "projection";
    shape[key] = redactValue(value, structural);
  }
  const fields = new Set<string>();
  collectFields(shape, fields);
  fields.delete("command");
  return { name, text: JSON.stringify(shape), fields };
}

function redactValue(value: unknown, structural: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, structural));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("$date" in record) return "?date";
    if ("$oid" in record) return "?objectId";
    if ("$numberLong" in record || "$numberDecimal" in record) return "?number";
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      const childStructural =
        structural || key === "sort" || key === "$sort" || key === "projection";
      redacted[key] = redactValue(child, childStructural);
    }
    return redacted;
  }
  if (structural && (value === 1 || value === -1 || value === 0 || typeof value === "boolean")) {
    return value;
  }
  if (typeof value === "string") return "?string";
  if (typeof value === "number") return "?number";
  if (typeof value === "boolean") return "?bool";
  if (value === null) return "?null";
  return "?unknown";
}

function collectFields(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectFields(item, into));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!key.startsWith("$")) into.add(key);
    collectFields(child, into);
  }
}

function groupLogs(logs: ParsedLog[]): Map<string, ShapeGroup> {
  const groups = new Map<string, ShapeGroup>();
  for (const log of logs) {
    const existing = groups.get(log.shapeKey);
    const group = existing ?? {
      namespace: log.namespace,
      command: log.command,
      shapeText: log.shapeText,
      count: 0,
      yields: [],
      plans: [],
      fields: new Set<string>(),
    };
    group.count += 1;
    addMetric(group, "docsExamined", log.docsExamined);
    addMetric(group, "docsReturned", log.docsReturned);
    addMetric(group, "keysExamined", log.keysExamined);
    addMetric(group, "workingMillis", log.workingMillis);
    addMetric(group, "bytesRead", log.bytesRead);
    if (log.numYields !== undefined) group.yields.push(log.numYields);
    if (log.planSummary) group.plans.push(log.planSummary);
    if (isLater(log, group)) {
      group.lastMicros = log.execMicros;
      group.lastTimestamp = log.timestamp;
    }
    for (const field of log.fields) group.fields.add(field);
    groups.set(log.shapeKey, group);
  }
  return groups;
}

function addMetric(
  group: ShapeGroup,
  key: "docsExamined" | "docsReturned" | "keysExamined" | "workingMillis" | "bytesRead",
  value: number | undefined,
): void {
  if (value === undefined) return;
  group[key] = (group[key] ?? 0) + value;
}

function isLater(log: ParsedLog, group: ShapeGroup): boolean {
  if (log.execMicros === undefined && log.timestamp === undefined) return false;
  if (!group.lastTimestamp && group.lastMicros === undefined) return true;
  if (log.timestamp && group.lastTimestamp) return log.timestamp >= group.lastTimestamp;
  return true;
}

function compareImpact(left: ShapeGroup, right: ShapeGroup): number {
  const docs = (right.docsExamined ?? 0) - (left.docsExamined ?? 0);
  if (docs !== 0) return docs;
  const millis = (right.workingMillis ?? 0) - (left.workingMillis ?? 0);
  if (millis !== 0) return millis;
  return right.count - left.count;
}

function renderEvidence(
  logCount: number,
  groups: ShapeGroup[],
  suggestions: SuggestedIndex[],
): string {
  const lines = [
    "# Query analysis evidence",
    "",
    "These blocks are computed from the Performance Advisor tool result. Cite only these formatted numbers. Do not recompute ratios or totals.",
    "",
    `The slow query logs are a sample of at most ${SLOW_QUERY_SAMPLE_LIMIT} recent log lines from this tool, not a \`$queryStats\` aggregate over each query shape's lifetime. This result contained ${logCount} log line(s) and ${groups.length} query shape(s).`,
  ];

  if (groups.length === 0) {
    lines.push("", "No slow query shapes were found in this sample.");
    return lines.join("\n");
  }

  groups.forEach((group, index) => {
    lines.push(
      "",
      "---",
      "",
      `Shape ${index + 1} of ${groups.length}`,
      "",
      "## Query Shape",
      `namespace: ${group.namespace}`,
      group.shapeText,
      "",
      "## Query Stats Metrics",
      ...statsLines(group),
      "",
      "## Bin Metadata",
      ...binLines(group),
      "",
      "## Performance Advisor Suggestion",
      renderSuggestion(matchSuggestion(group, suggestions)),
    );
  });
  return lines.join("\n");
}

function statsLines(group: ShapeGroup): string[] {
  const lines = [`- Command: ${group.command}`];
  appendDisplayed(lines, "Execution count", group.count, "execCount");
  appendDisplayed(lines, "Total working time", group.workingMillis, "totalWorkingMillis");
  if (group.workingMillis !== undefined && group.count > 0) {
    appendDisplayed(lines, "Avg working time", group.workingMillis / group.count, "avgWorkingMillis");
  }
  appendDisplayed(lines, "Last execution time", group.lastMicros, "lastExecMicros");
  appendDisplayed(lines, "Index keys examined", group.keysExamined, "keysExamined");
  appendDisplayed(lines, "Docs examined", group.docsExamined, "docsExamined");
  appendDisplayed(lines, "Docs returned", group.docsReturned, "docsReturned");
  if (group.keysExamined !== undefined && group.docsReturned !== undefined) {
    appendDisplayed(
      lines,
      "Index keys examined:returned ratio",
      group.docsReturned === 0 ? Number.NaN : group.keysExamined / group.docsReturned,
      "keysExaminedRatio",
    );
  }
  if (group.docsExamined !== undefined && group.docsReturned !== undefined) {
    appendDisplayed(
      lines,
      "Docs examined:returned ratio",
      group.docsReturned === 0 ? Number.NaN : group.docsExamined / group.docsReturned,
      "docsExaminedRatio",
    );
  }
  appendDisplayed(lines, "Bytes read", group.bytesRead, "bytesRead");
  return lines;
}

function appendDisplayed(
  lines: string[],
  label: string,
  value: number | undefined,
  statKey: string,
): void {
  if (value === undefined) return;
  lines.push(`- ${label}: ${displayQueryStat(statKey, value).trim()}`);
}

function binLines(group: ShapeGroup): string[] {
  const lines: string[] = [];
  const hasSort = group.plans.some(planHasSort);
  const usesIndex = indexUsage(group.plans);
  if (group.plans.length > 0) {
    lines.push(`- Has sort stage: ${hasSort}`);
    if (usesIndex !== undefined) lines.push(`- Uses index: ${usesIndex}`);
  }
  if (group.yields.length > 0) {
    const average = group.yields.reduce((sum, value) => sum + value, 0) / group.yields.length;
    lines.push(`- numYields: ${formatYields(average)}`);
  }
  return lines.length > 0 ? lines : ["- Bin metadata was not present on the sampled logs."];
}

function planHasSort(plan: string): boolean {
  return /(^|[^A-Z])SORT([^A-Z]|$)/.test(plan);
}

function indexUsage(plans: string[]): boolean | undefined {
  if (plans.some((plan) => plan.includes("COLLSCAN"))) return false;
  if (
    plans.some((plan) =>
      /\b(IXSCAN|IDHACK|COUNT_SCAN|DISTINCT_SCAN|EXPRESS_IXSCAN|CLUSTERED_IXSCAN)\b/.test(plan),
    )
  ) {
    return true;
  }
  return undefined;
}

function formatYields(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function matchSuggestion(group: ShapeGroup, suggestions: SuggestedIndex[]): SuggestedIndex | undefined {
  const candidates = suggestions.filter((suggestion) => suggestion.namespace === group.namespace);
  if (candidates.length === 0) return undefined;
  const scored = candidates.map((suggestion) => ({
    suggestion,
    overlap: indexFields(suggestion).filter((field) => group.fields.has(field)).length,
    weight: typeof suggestion.weight === "number" ? suggestion.weight : 0,
  }));
  scored.sort((left, right) => right.overlap - left.overlap || right.weight - left.weight);
  const best = scored[0];
  if (!best) return undefined;
  if (best.overlap > 0 || candidates.length === 1) return best.suggestion;
  return undefined;
}

function indexFields(suggestion: SuggestedIndex): string[] {
  const fields: string[] = [];
  const index = suggestion.index;
  const keys = Array.isArray(index) ? index : index && typeof index === "object" ? [index] : [];
  for (const key of keys) {
    if (!key || typeof key !== "object") continue;
    fields.push(...Object.keys(key as Record<string, unknown>));
  }
  return fields;
}

function renderSuggestion(suggestion: SuggestedIndex | undefined): string {
  if (!suggestion) return NO_SUGGESTION;
  const pattern: Record<string, unknown> = {};
  for (const field of indexFields(suggestion)) {
    const index = suggestion.index;
    const keys = Array.isArray(index) ? index : [index];
    for (const key of keys) {
      if (key && typeof key === "object" && field in (key as Record<string, unknown>)) {
        pattern[field] = (key as Record<string, unknown>)[field];
      }
    }
  }
  const rendered = JSON.stringify(pattern);
  if (suggestion.collation && typeof suggestion.collation === "object") {
    return `${rendered}\nCollation: ${JSON.stringify(suggestion.collation)}`;
  }
  return rendered;
}

function appendContent(content: MessageContent, evidence: string): MessageContent {
  if (typeof content === "string") return `${content}\n\n${evidence}`;
  return [...content, { type: "text", text: evidence }];
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function nestedNumber(
  record: Record<string, unknown>,
  parents: string[],
  key: string,
): number | undefined {
  for (const parent of parents) {
    const child = record[parent];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const value = asNumber((child as Record<string, unknown>)[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function readTimestamp(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const t = (parsed as { t?: unknown }).t;
  if (!t || typeof t !== "object") return undefined;
  const date = (t as { $date?: unknown }).$date;
  return typeof date === "string" ? date : undefined;
}

function matchOne(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.[1];
}

function firstMatchNumber(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match?.[1] === undefined ? undefined : asNumber(match[1]);
}

function shellToJson(input: string): unknown {
  const quoted = input.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  return parseJson(quoted);
}

function redactLegacySnippet(snippet: string): string {
  return snippet
    .replace(/"(?:\\.|[^"\\])*"/g, '"?string"')
    .replace(/-?\d+(?:\.\d+)?/g, "?number");
}
