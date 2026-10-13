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

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const INSTALL_TIMEOUT_MS = 5 * 60_000;

interface SkillsCliEntry {
  name?: string;
  status?: string;
  path?: string;
  reason?: string;
  error?: string;
}

function skillsCliEntrypoint(): string {
  const manifestPath = require.resolve("skills/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin: Record<string, string>;
  };
  return join(dirname(manifestPath), manifest.bin.skills);
}

async function installIntoDir(
  sourceArg: string,
  skillNames: string[],
  workDir: string,
): Promise<Map<string, string>> {
  const args = [
    skillsCliEntrypoint(),
    "add",
    sourceArg,
    ...skillNames.flatMap((name) => ["-s", name]),
    "-a",
    "universal",
    "--copy",
    "-y",
    "--json",
  ];

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: workDir,
      env: { ...process.env, DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" },
      maxBuffer: 32 * 1024 * 1024,
      timeout: INSTALL_TIMEOUT_MS,
    }));
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    stdout = failed.stdout ?? "";
    stderr = failed.stderr ?? "";
  }

  let entries: SkillsCliEntry[];
  try {
    entries = JSON.parse(stdout) as SkillsCliEntry[];
  } catch {
    throw new Error(
      `The skills CLI failed to fetch ${sourceArg}: ${stderr.trim() || "no output"}`,
    );
  }

  const failure = entries.find((entry) => entry.status === "failed");
  if (failure && !failure.name) {
    throw new Error(`Could not fetch ${sourceArg}: ${failure.error}`);
  }

  const dirs = new Map<string, string>();
  for (const name of skillNames) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry || entry.status !== "installed" || !entry.path) {
      const reason = entry?.reason ? ` (${entry.reason})` : "";
      throw new Error(`Skill "${name}" was not found in ${sourceArg}${reason}`);
    }
    if (!existsSync(join(entry.path, "SKILL.md"))) {
      throw new Error(`Skill "${name}" from ${sourceArg} has no SKILL.md`);
    }
    dirs.set(name, entry.path);
  }
  return dirs;
}

/**
 * Fetches the named skills into a temporary directory, runs `use` with a map of
 * skill name to staged directory, then deletes the temporary directory.
 */
export async function withStagedSkills<T>(
  sourceArg: string,
  skillNames: string[],
  use: (stagedDirs: Map<string, string>) => Promise<T>,
): Promise<T> {
  const workDir = await mkdtemp(join(tmpdir(), "update-skills-"));
  try {
    const stagedDirs = await installIntoDir(sourceArg, skillNames, workDir);
    return await use(stagedDirs);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
