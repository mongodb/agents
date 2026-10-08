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

import { pathToFileURL } from "node:url";

import yargs from "yargs";

import { DEFAULT_WORKSPACE } from "./defaults.js";
import { SCENARIO_NAMES, type ScenarioName } from "./load/scenarios.js";
import { runFetchLogs } from "./cli/fetchLogs.js";
import { runLoad } from "./cli/load.js";
import { runReport } from "./cli/report.js";

export interface LoadCommandOptions {
  scenario: ScenarioName;
  sessions?: number;
  rate?: string;
  gap?: string;
  gaps?: string;
  concurrency?: number;
  interval?: string;
  runId?: string;
  workspace: string;
}

export interface WindowCommandOptions {
  runId?: string;
  since?: string;
  until?: string;
  /** Omitted means the run's stored workspace, or the default for a new window. */
  workspace?: string;
}

export interface CliHandlers {
  load: (options: LoadCommandOptions) => void | Promise<void>;
  fetchLogs: (options: WindowCommandOptions) => void | Promise<void>;
  report: (options: WindowCommandOptions) => void | Promise<void>;
}

export function createCli(handlers: CliHandlers) {
  return yargs()
    .scriptName("agent-engine-load-test")
    .demandCommand(1, "Choose a command: load, fetch-logs, or report.")
    .strict()
    .help()
    .version(false)
    .exitProcess(false)
    .fail((message, error) => {
      throw error ?? new Error(message);
    })
    .command(
      "load",
      "Run a load scenario against the deployed agent",
      (args) =>
        args
          .option("scenario", {
            type: "string",
            demandOption: true,
            choices: [...SCENARIO_NAMES],
            description: "Scenario to run",
          })
          .option("sessions", {
            type: "number",
            description:
              "Number of sessions. For recovery-probe, the maximum attempts.",
          })
          .option("rate", {
            type: "string",
            description: "Ramp rate, for example 45/h",
          })
          .option("gap", {
            type: "string",
            description: "Delay before the second turn, for example 30s",
          })
          .option("gaps", {
            type: "string",
            description:
              "ttl-probe delays between turns, for example 280s,590s,620s",
          })
          .option("concurrency", {
            type: "number",
            description: "Sessions to start together for the concurrency scenario",
          })
          .option("interval", {
            type: "string",
            description: "Delay between recovery-probe attempts, for example 5m",
          })
          .option("run-id", {
            type: "string",
            description: "Directory name under results/",
          })
          .option("workspace", {
            type: "string",
            default: DEFAULT_WORKSPACE,
            description: "agentengine workspace name used for status and logs",
          }),
      (argv) => {
        const scenario = argv["scenario"];
        if (!isScenarioName(scenario)) {
          throw new Error(`Unknown scenario ${String(scenario)}`);
        }
        return handlers.load({
          scenario,
          ...optionalNumber(argv["sessions"], "sessions"),
          ...optionalString(argv["rate"], "rate"),
          ...optionalString(argv["gap"], "gap"),
          ...optionalString(argv["gaps"], "gaps"),
          ...optionalNumber(argv["concurrency"], "concurrency"),
          ...optionalString(argv["interval"], "interval"),
          ...optionalString(argv["runId"], "runId"),
          workspace: stringOption(argv["workspace"], DEFAULT_WORKSPACE),
        });
      },
    )
    .command(
      "fetch-logs",
      "Download runtime-diag and token-limit logs for a run or a time window",
      (args) => windowOptions(args),
      (argv) => handlers.fetchLogs(windowFromArgv(argv)),
    )
    .command(
      "report",
      "Write report.md and report.json from a run, or from a time window",
      (args) => windowOptions(args),
      (argv) => handlers.report(windowFromArgv(argv)),
    );
}

function windowOptions(args: ReturnType<typeof yargs>) {
  return args
    .option("run", {
      type: "string",
      description: "Run id under results/",
    })
    .option("since", {
      type: "string",
      description: "Window start as an ISO-8601 timestamp",
    })
    .option("until", {
      type: "string",
      description: "Window end as an ISO-8601 timestamp",
    })
    .option("workspace", {
      type: "string",
      description:
        "agentengine workspace name. Omit it to use the run's workspace, or the default for --since/--until.",
    });
}

function windowFromArgv(
  argv: Record<string, unknown>,
): WindowCommandOptions {
  return {
    ...optionalString(argv["run"], "runId"),
    ...optionalString(argv["since"], "since"),
    ...optionalString(argv["until"], "until"),
    ...optionalString(argv["workspace"], "workspace"),
  };
}

function optionalString(
  value: unknown,
  key: string,
): Record<string, string> {
  return typeof value === "string" ? { [key]: value } : {};
}

function optionalNumber(
  value: unknown,
  key: string,
): Record<string, number> {
  return typeof value === "number" ? { [key]: value } : {};
}

function stringOption(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isScenarioName(value: unknown): value is ScenarioName {
  return (
    typeof value === "string" &&
    (SCENARIO_NAMES as readonly string[]).includes(value)
  );
}

export function normalizeArgv(argv: string[]): string[] {
  // pnpm forwards a literal "--" when flags are passed after the script name.
  return argv.filter((arg) => arg !== "--");
}

export async function main(argv: string[]): Promise<void> {
  const cli = createCli({
    load: async (options) => {
      await runLoad(options);
    },
    fetchLogs: async (options) => {
      await runFetchLogs(options);
    },
    report: async (options) => {
      await runReport(options);
    },
  });
  await cli.parseAsync(normalizeArgv(argv));
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
