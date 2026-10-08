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
import { DEFAULT_WORKSPACE } from "../defaults.js";
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
  const outFile = path.join(directory, "logs.ndjson");
  await fetchLogs({
    since,
    until,
    workspace: meta.workspace,
    outFile,
    runner,
  });
  // Record the fetched window beside the load window. Writing it into since/until
  // would make the next default fetch pad the already padded end again.
  writeRunMeta(directory, {
    ...meta,
    logWindow: { since: since.toISOString(), until: until.toISOString() },
  });
  console.log(`Wrote ${outFile}`);
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
    runWorkspace(meta, options.workspace);
    const since = options.since
      ? parseTimestamp(options.since, "--since")
      : new Date(meta.since);
    // Pad from the load end, never from a fetched window, so repeated fetches agree.
    const until = options.until
      ? parseTimestamp(options.until, "--until")
      : new Date(Date.parse(meta.until) + LOG_PAD_MS);
    return { directory, meta, since, until };
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
    workspace: options.workspace ?? DEFAULT_WORKSPACE,
    since: since.toISOString(),
    until: until.toISOString(),
    orchestrationEngineImage: null,
    engineImageObservedAt: null,
  };
  return { directory, meta, since, until };
}

/**
 * The workspace a run was loaded against. An explicit --workspace that differs
 * is rejected, so a report never mixes one workspace's turns with another's logs.
 */
export function runWorkspace(meta: RunMeta, requested: string | undefined): string {
  if (requested !== undefined && requested !== meta.workspace) {
    throw new Error(
      `Run ${meta.runId} was loaded against workspace ${meta.workspace}. Omit --workspace to use it.`,
    );
  }
  return meta.workspace;
}

export function parseTimestamp(value: string, flag: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} must be an ISO-8601 timestamp, got "${value}".`);
  }
  return date;
}
