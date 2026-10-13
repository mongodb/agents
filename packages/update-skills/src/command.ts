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

import { resolve } from "node:path";

import yargs from "yargs";

import { CONFIG_FILE_NAME } from "./config.js";
import {
  hasChanges,
  isOutOfDate,
  LOCK_FILE_NAME,
  updateSkills,
  type UpdateMode,
  type UpdateReport,
} from "./update.js";

export function formatReport(report: UpdateReport, mode: UpdateMode): string[] {
  const lines: string[] = [];
  const anyChanges = report.skills.some(hasChanges) || report.lock.changed;

  for (const skill of report.skills) {
    if (!hasChanges(skill)) {
      lines.push(`skills/${skill.name}: up to date`);
      continue;
    }
    lines.push(
      `skills/${skill.name}: ${skill.added.length} added, ${skill.changed.length} changed, ${skill.removed.length} removed`,
    );
    for (const file of skill.added) lines.push(`  + ${file}`);
    for (const file of skill.changed) lines.push(`  ~ ${file}`);
    for (const file of skill.removed) lines.push(`  - ${file}`);
  }

  for (const name of report.unlisted) {
    lines.push(
      `warning: skills/${name} is not in ${CONFIG_FILE_NAME}, so it was left unchanged`,
    );
  }

  const lockVerb = mode === "apply" ? "updated" : "would update";
  lines.push(
    report.lock.changed
      ? `${LOCK_FILE_NAME}: ${lockVerb}`
      : `${LOCK_FILE_NAME}: up to date`,
  );

  if (mode === "check") {
    lines.push(
      isOutOfDate(report)
        ? "Out of date. Run the update without --check to apply the changes."
        : "All listed skills match upstream.",
    );
  } else if (mode === "dry-run") {
    lines.push("Dry run: no files were written.");
  } else {
    lines.push(
      anyChanges ? "Skills and lock file updated." : "Already up to date.",
    );
  }
  return lines;
}

/**
 * Runs the CLI and returns the process exit code. `baseDir` is where relative
 * agent paths are resolved from.
 */
export async function runCli(argv: string[], baseDir: string): Promise<number> {
  let exitCode = 0;

  await yargs(argv)
    .scriptName("update-skills")
    .command(
      "$0 <agentDir>",
      "Update the skills listed in <agentDir>/skills.config.json from mongodb/agent-skills",
      (command) =>
        command
          .positional("agentDir", {
            type: "string",
            demandOption: true,
            describe: "Agent directory that contains skills.config.json",
          })
          .option("dry-run", {
            type: "boolean",
            default: false,
            describe: "Show what would change without writing files",
          })
          .option("check", {
            type: "boolean",
            default: false,
            describe: "Exit non-zero if any listed skill differs from upstream",
          }),
      async (args) => {
        if (args.dryRun && args.check) {
          throw new Error("Use either --dry-run or --check, not both.");
        }
        const mode: UpdateMode = args.check
          ? "check"
          : args.dryRun
            ? "dry-run"
            : "apply";
        const agentDir = resolve(baseDir, args.agentDir);

        const report = await updateSkills(agentDir, mode);
        for (const line of formatReport(report, mode)) {
          console.log(line);
        }
        exitCode = mode === "check" && isOutOfDate(report) ? 1 : 0;
      },
    )
    .strict()
    .help()
    .version(false)
    .exitProcess(false)
    .fail((message, error) => {
      if (error) {
        throw error;
      }
      throw new Error(`${message}\nRun update-skills --help for usage.`);
    })
    .parseAsync();

  return exitCode;
}
