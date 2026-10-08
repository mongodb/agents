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

import { execCommand } from "../command.js";
import { readOrchestrationEngineImage } from "../engineImage.js";
import { readTurnLog } from "../load/runScenario.js";
import { fetchLogs, type CommandRunner } from "../logs/fetchLogs.js";
import { parseRuntimeDiagLogs } from "../logs/parseRuntimeDiag.js";
import { runDirectory } from "../paths.js";
import { buildReport, type RunMeta } from "../report/buildReport.js";
import { renderMarkdown } from "../report/renderMarkdown.js";
import type { WindowCommandOptions } from "../cli.js";
import { resolveFetch, runWorkspace } from "./fetchLogs.js";
import { readRunMeta, writeRunMeta } from "./meta.js";

export async function runReport(
  options: WindowCommandOptions,
  runner: CommandRunner = { run: execCommand },
): Promise<string> {
  const directory = options.runId
    ? runDirectory(options.runId)
    : (await fetchWindow(options, runner)).directory;
  let meta = readRunMeta(directory);
  if (options.runId) {
    runWorkspace(meta, options.workspace);
  }
  const logsFile = path.join(directory, "logs.ndjson");
  if (!fs.existsSync(logsFile)) {
    throw new Error(
      `No logs at ${logsFile}. Run fetch-logs --run ${meta.runId} first.`,
    );
  }
  if (!meta.orchestrationEngineImage) {
    const observedAt = new Date();
    meta = {
      ...meta,
      orchestrationEngineImage: await readOrchestrationEngineImage(
        runner,
        meta.workspace,
      ),
      engineImageObservedAt: observedAt.toISOString(),
    };
    writeRunMeta(directory, meta);
  }
  const clientFile = path.join(directory, "client.jsonl");
  const report = buildReport({
    meta,
    events: parseRuntimeDiagLogs(fs.readFileSync(logsFile, "utf8")),
    ...(fs.existsSync(clientFile) ? { turns: readTurnLog(clientFile) } : {}),
  });
  const markdown = renderMarkdown(report);
  fs.writeFileSync(path.join(directory, "report.md"), markdown);
  fs.writeFileSync(
    path.join(directory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(markdown);
  return directory;
}

async function fetchWindow(
  options: WindowCommandOptions,
  runner: CommandRunner,
): Promise<{ directory: string; meta: RunMeta }> {
  const resolved = resolveFetch(options);
  const observedAt = new Date();
  const image = await readOrchestrationEngineImage(runner, resolved.meta.workspace);
  const meta: RunMeta = {
    ...resolved.meta,
    orchestrationEngineImage: image,
    engineImageObservedAt: observedAt.toISOString(),
  };
  writeRunMeta(resolved.directory, meta);
  await fetchLogs({
    since: resolved.since,
    until: resolved.until,
    workspace: meta.workspace,
    outFile: path.join(resolved.directory, "logs.ndjson"),
    runner,
  });
  return { directory: resolved.directory, meta };
}
