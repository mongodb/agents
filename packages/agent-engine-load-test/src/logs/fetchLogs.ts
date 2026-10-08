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

import * as fs from "node:fs";
import * as path from "node:path";

import { parseLogOutput, type PlatformLogRecord } from "./parseRuntimeDiag.js";

/** The CLI rejects interactive queries longer than this. */
export const MAX_LOG_WINDOW_MS = 6 * 60 * 60 * 1000;

const GREPS = ["runtime-diag", "Access Token limit"] as const;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  run(args: string[]): Promise<CommandResult>;
}

export interface LogWindow {
  since: Date;
  until: Date;
}

export function splitLogWindow(
  since: Date,
  until: Date,
  maxMs = MAX_LOG_WINDOW_MS,
): LogWindow[] {
  const windows: LogWindow[] = [];
  let cursor = since.getTime();
  const end = until.getTime();
  if (end <= cursor) {
    return windows;
  }
  while (cursor < end) {
    const next = Math.min(cursor + maxMs, end);
    windows.push({ since: new Date(cursor), until: new Date(next) });
    cursor = next;
  }
  return windows;
}

export async function fetchLogs(options: {
  since: Date;
  until: Date;
  workspace: string;
  outFile: string;
  runner: CommandRunner;
}): Promise<PlatformLogRecord[]> {
  const records: PlatformLogRecord[] = [];
  const seen = new Set<string>();
  for (const window of splitLogWindow(options.since, options.until)) {
    for (const grep of GREPS) {
      const args = [
        "agentengine",
        "--no-log",
        "logs",
        "--json",
        "--all",
        "--workspace",
        options.workspace,
        "--since",
        window.since.toISOString(),
        "--until",
        window.until.toISOString(),
        "--grep",
        grep,
      ];
      const result = await options.runner.run(args);
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || `exit ${result.exitCode}`;
        throw new Error(
          `agentengine logs failed for ${window.since.toISOString()} to ${window.until.toISOString()}: ${detail}`,
        );
      }
      const parsed = parseLogOutput(result.stdout);
      if (parsed.truncated) {
        throw new Error(
          `agentengine logs truncated the window ${window.since.toISOString()} to ${window.until.toISOString()}. Narrow the query and run it again.`,
        );
      }
      for (const record of parsed.records) {
        const key = `${record.timestamp}\n${record.message}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        records.push(record);
      }
    }
  }
  records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  fs.mkdirSync(path.dirname(options.outFile), { recursive: true });
  const body =
    records.length === 0
      ? ""
      : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  fs.writeFileSync(options.outFile, body);
  return records;
}
