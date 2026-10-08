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

/**
 * Parses Agent Engine log output into runtime-diagnostics events.
 *
 * `agentengine logs --json --all` prints one JSON object per line, sometimes
 * after a `context:` preamble. `agentengine logs --json --tail` prints one
 * pretty-printed `{ logs, hasMore }` document. Both are accepted.
 */

export interface PlatformLogRecord {
  timestamp: string;
  message: string;
  service?: string;
  level?: string;
  fields?: { component?: string };
}

export interface ParsedLogOutput {
  records: PlatformLogRecord[];
  truncated: boolean;
}

export type RuntimeMode = "aer" | "tool";

interface DiagEventBase {
  timestamp: string;
  instanceId: string;
  mode: RuntimeMode;
  service: string | null;
}

export type DiagEvent =
  | (DiagEventBase & {
      kind: "process_start";
      pid: number | null;
      host: string | null;
      tokenCaches: Record<string, "present" | "absent">;
    })
  | (DiagEventBase & {
      kind: "graph_build";
      n: number | null;
      uptimeSeconds: number | null;
    })
  | (DiagEventBase & {
      kind: "execution";
      n: number | null;
      sessionId: string | null;
      executionId: string | null;
      uptimeSeconds: number | null;
    })
  | (DiagEventBase & {
      kind: "mcp_token_cached";
      server: string | null;
      n: number | null;
      fingerprint: string | null;
      expiry: string | null;
      cacheUpdatedAt: string | null;
      uptimeSeconds: number | null;
    })
  | (DiagEventBase & {
      kind: "signal_received";
      signal: string | null;
      uptimeSeconds: number | null;
      executions: number | null;
      graphBuilds: number | null;
      tokensSeen: number | null;
    })
  | (DiagEventBase & {
      kind: "process_exit";
      code: number | null;
      uptimeSeconds: number | null;
      executions: number | null;
      graphBuilds: number | null;
      tokensSeen: number | null;
    })
  | {
      kind: "token_limit_error";
      timestamp: string;
      service: string | null;
      message: string;
    };

const DIAG_LINE =
  /\[runtime-diag\]\s+instance=(\S+)\s+mode=(\S+)\s+(\S+)(?:\s+(.*))?/;

const TOKEN_LIMIT = "Access Token limit reached";

export function parseLogOutput(input: string): ParsedLogOutput {
  const trimmed = input.trim();
  if (!trimmed) {
    return { records: [], truncated: false };
  }
  const start = trimmed.search(/[{[]/);
  if (start < 0) {
    return { records: [], truncated: false };
  }
  const document = tryParseDocument(trimmed.slice(start));
  if (document) {
    return document;
  }
  return parseNdjson(trimmed);
}

export function parseRuntimeDiagLogs(input: string): DiagEvent[] {
  return eventsFromRecords(parseLogOutput(input).records);
}

export function eventsFromRecords(records: PlatformLogRecord[]): DiagEvent[] {
  const events: DiagEvent[] = [];
  for (const record of records) {
    const event = eventFromRecord(record);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function tryParseDocument(body: string): ParsedLogOutput | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  return outputFromValue(value);
}

function parseNdjson(input: string): ParsedLogOutput {
  const records: PlatformLogRecord[] = [];
  let truncated = false;
  for (const line of input.split(/\r?\n/)) {
    const start = line.indexOf("{");
    if (start < 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line.slice(start));
    } catch {
      continue;
    }
    const parsed = outputFromValue(value);
    if (!parsed) {
      continue;
    }
    records.push(...parsed.records);
    truncated = truncated || parsed.truncated;
  }
  return { records, truncated };
}

function outputFromValue(value: unknown): ParsedLogOutput | undefined {
  if (Array.isArray(value)) {
    return { records: value.filter(isLogRecord), truncated: false };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (Array.isArray(value["logs"])) {
    return {
      records: value["logs"].filter(isLogRecord),
      truncated: value["hasMore"] === true,
    };
  }
  if (isLogRecord(value)) {
    return { records: [value], truncated: false };
  }
  return undefined;
}

function eventFromRecord(record: PlatformLogRecord): DiagEvent | undefined {
  if (record.message.includes(TOKEN_LIMIT)) {
    return {
      kind: "token_limit_error",
      timestamp: record.timestamp,
      service: record.service ?? null,
      message: record.message,
    };
  }
  const match = DIAG_LINE.exec(record.message);
  if (!match) {
    return undefined;
  }
  const mode = normalizeMode(match[2] ?? "");
  if (!mode) {
    return undefined;
  }
  const kind = match[3] ?? "";
  const fields = parseFields(match[4] ?? "");
  const base: DiagEventBase = {
    timestamp: record.timestamp,
    instanceId: match[1] ?? "",
    mode,
    service: record.service ?? null,
  };
  switch (kind) {
    case "process_start":
      return {
        ...base,
        kind,
        pid: integer(fields["pid"]),
        host: fields["host"] ?? null,
        tokenCaches: parseTokenCaches(fields["mcp_token_cache"]),
      };
    case "graph_build":
      return {
        ...base,
        kind,
        n: integer(fields["n"]),
        uptimeSeconds: uptime(fields["uptime"]),
      };
    case "execution":
      return {
        ...base,
        kind,
        n: integer(fields["n"]),
        sessionId: known(fields["session"]),
        executionId: known(fields["execution_id"]),
        uptimeSeconds: uptime(fields["uptime"]),
      };
    case "mcp_token_cached":
      return {
        ...base,
        kind,
        server: fields["server"] ?? null,
        n: integer(fields["n"]),
        fingerprint: fields["fingerprint"] ?? null,
        expiry: known(fields["expiry"]),
        cacheUpdatedAt: known(fields["cache_updated_at"]),
        uptimeSeconds: uptime(fields["uptime"]),
      };
    case "signal_received":
      return {
        ...base,
        kind,
        signal: fields["signal"] ?? null,
        ...lifetime(fields),
      };
    case "process_exit":
      return {
        ...base,
        kind,
        code: integer(fields["code"]),
        ...lifetime(fields),
      };
    default:
      return undefined;
  }
}

function lifetime(fields: Record<string, string>): {
  uptimeSeconds: number | null;
  executions: number | null;
  graphBuilds: number | null;
  tokensSeen: number | null;
} {
  return {
    uptimeSeconds: uptime(fields["uptime"]),
    executions: integer(fields["executions"]),
    graphBuilds: integer(fields["graph_builds"]),
    tokensSeen: integer(fields["tokens_seen"]),
  };
}

function parseFields(rest: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const token of rest.split(/\s+/)) {
    if (!token) {
      continue;
    }
    const eq = token.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    fields[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return fields;
}

function parseTokenCaches(
  value: string | undefined,
): Record<string, "present" | "absent"> {
  if (!value || value === "none") {
    return {};
  }
  const caches: Record<string, "present" | "absent"> = {};
  for (const part of value.split(",")) {
    const sep = part.lastIndexOf(":");
    if (sep <= 0) {
      continue;
    }
    const state = part.slice(sep + 1);
    if (state === "present" || state === "absent") {
      caches[part.slice(0, sep)] = state;
    }
  }
  return caches;
}

function normalizeMode(mode: string): RuntimeMode | undefined {
  if (mode === "aer" || mode === "tool") {
    return mode;
  }
  return undefined;
}

function known(value: string | undefined): string | null {
  if (!value || value === "unknown") {
    return null;
  }
  return value;
}

function integer(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

function uptime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^(\d+)s$/.exec(value);
  return match ? Number(match[1]) : null;
}

function isLogRecord(value: unknown): value is PlatformLogRecord {
  return (
    isRecord(value) &&
    typeof value["timestamp"] === "string" &&
    typeof value["message"] === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
