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

import * as path from "node:path";

import { execCommand } from "../command.js";
import { fetchLogs, type CommandRunner } from "../logs/fetchLogs.js";
import { defaultRunId, runDirectory } from "../paths.js";
import type { RunMeta } from "../report/buildReport.js";
import type { WindowCommandOptions } from "../cli.js";
import { readRunMeta, writeRunMeta } from "./meta.js";

/** Extra time after a run so paused sandboxes can log the token they minted. */
const LOG_PAD_MS = 2 * 60 * 1000;

export async function runFetchLogs(
  options: WindowCommandOptions,
  runner: CommandRunner = { run: execCommand },
): Promise<string> {
  const { directory, meta, since, until } = resolveFetch(options);
  await fetchLogs({
    since,
    until,
    workspace: meta.workspace,
    outFile: path.join(directory, "logs.ndjson"),
    runner,
  });
  writeRunMeta(directory, {
    ...meta,
    since: since.toISOString(),
    until: until.toISOString(),
  });
  console.log(`Wrote ${path.join(directory, "logs.ndjson")}`);
  return meta.runId;
}

export function resolveFetch(options: WindowCommandOptions): {
  directory: string;
  meta: RunMeta;
  since: Date;
  until: Date;
} {
  if (options.runId) {
    const directory = runDirectory(options.runId);
    const meta = readRunMeta(directory);
    const since = options.since
      ? parseTimestamp(options.since, "--since")
      : new Date(meta.since);
    const until = options.until
      ? parseTimestamp(options.until, "--until")
      : new Date(Date.parse(meta.until) + LOG_PAD_MS);
    return { directory, meta: { ...meta, workspace: options.workspace || meta.workspace }, since, until };
  }
  if (!options.since || !options.until) {
    throw new Error("Pass --run, or both --since and --until.");
  }
  const since = parseTimestamp(options.since, "--since");
  const until = parseTimestamp(options.until, "--until");
  const runId = defaultRunId("logs");
  const directory = runDirectory(runId);
  const meta: RunMeta = {
    runId,
    workspace: options.workspace,
    since: since.toISOString(),
    until: until.toISOString(),
    orchestrationEngineImage: null,
    engineImageObservedAt: null,
  };
  return { directory, meta, since, until };
}

export function parseTimestamp(value: string, flag: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} must be an ISO-8601 timestamp, got "${value}".`);
  }
  return date;
}
