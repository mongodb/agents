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

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

/**
 * Copies each skill directory in `sourceDir` into `targetDir`, creating
 * `targetDir` if needed. A skill that already exists in `targetDir` is
 * replaced, so files removed from the bundled copy are removed here too.
 * Entries in `targetDir` that are not bundled skills are left alone.
 *
 * Returns the copied skill names, sorted.
 */
export async function syncSkills(
  sourceDir: string,
  targetDir: string,
): Promise<string[]> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const skills = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  await fs.mkdir(targetDir, { recursive: true });
  for (const skill of skills) {
    const target = path.join(targetDir, skill);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(path.join(sourceDir, skill), target, { recursive: true });
  }
  return skills;
}

export interface SkillsCliOptions {
  /** Command name shown in usage and messages, such as `atlas-explorer-agent`. */
  readonly bin: string;
  /** The skills directory bundled in the calling package. */
  readonly skillsDir: string;
  readonly argv: readonly string[];
  /** Directory that a relative `--dir` resolves against. */
  readonly cwd: string;
  readonly log?: (line: string) => void;
  readonly error?: (line: string) => void;
}

/**
 * Runs `<bin> sync-skills [--dir <path>]` and returns the exit code. The
 * default target is `./skills`, where Agent Engine reads an agent's skills.
 */
export async function runSkillsCli({
  bin,
  skillsDir,
  argv,
  cwd,
  log = console.log,
  error = console.error,
}: SkillsCliOptions): Promise<number> {
  const usage = [
    `Usage: ${bin} sync-skills [--dir <path>]`,
    "",
    `Copies the MongoDB skills bundled in ${bin} into <path>.`,
    "  --dir   Target directory (default: ./skills)",
  ].join("\n");

  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        dir: { type: "string", default: "skills" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    error(`${err instanceof Error ? err.message : String(err)}\n\n${usage}`);
    return 1;
  }

  const { positionals, values } = parsed;
  if (values.help) {
    log(usage);
    return 0;
  }
  if (positionals.length !== 1 || positionals[0] !== "sync-skills") {
    error(usage);
    return 1;
  }

  const targetDir = path.resolve(cwd, values.dir);
  const skills = await syncSkills(skillsDir, targetDir);
  log(
    `Copied ${skills.length} skills to ${path.relative(cwd, targetDir) || "."}: ${skills.join(", ")}`,
  );
  return 0;
}
