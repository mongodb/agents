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

import { cp, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface SyncBundledSkillsOptions {
  /** Bundled `skills/` directory inside the agent package. */
  readonly sourceDir: string;
  /** Destination `skills/` directory (for example `<agentRoot>/skills`). */
  readonly targetDir: string;
}

export interface SyncBundledSkillsResult {
  readonly targetDir: string;
  readonly skills: string[];
}

export interface RunSyncSkillsCliOptions {
  readonly binName: string;
  readonly sourceDir: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

function isSameOrContainedPath(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function resolveWithRealAncestor(targetPath: string): Promise<string> {
  const tail: string[] = [];
  let current = resolve(targetPath);

  while (true) {
    try {
      const realAncestor = await realpath(current);
      return tail.length > 0 ? join(realAncestor, ...tail) : realAncestor;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return resolve(targetPath);
      }
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Copies each skill directory from `sourceDir` into `targetDir`, replacing any
 * prior copy of those bundled skills while leaving unrelated directories in
 * `targetDir` untouched.
 */
export async function syncBundledSkills(
  options: SyncBundledSkillsOptions,
): Promise<SyncBundledSkillsResult> {
  let resolvedSource: string;
  try {
    resolvedSource = await realpath(options.sourceDir);
    const info = await stat(resolvedSource);
    if (!info.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new Error(`Bundled skills directory not found: ${options.sourceDir}`);
  }

  const resolvedTarget = resolve(options.targetDir);
  const canonicalTarget = await resolveWithRealAncestor(resolvedTarget);
  if (
    isSameOrContainedPath(resolvedSource, canonicalTarget) ||
    isSameOrContainedPath(canonicalTarget, resolvedSource)
  ) {
    throw new Error(
      `Refusing to sync skills into overlapping path: ${options.targetDir}`,
    );
  }

  const entries = await readdir(resolvedSource, { withFileTypes: true });
  const skills = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  if (skills.length === 0) {
    throw new Error(`No bundled skills found in ${options.sourceDir}`);
  }

  for (const name of skills) {
    const manifestPath = join(resolvedSource, name, "SKILL.md");
    const manifestStat = await stat(manifestPath).catch(() => null);
    if (!manifestStat?.isFile()) {
      throw new Error(`Bundled skill "${name}" is missing SKILL.md`);
    }
  }

  await mkdir(resolvedTarget, { recursive: true });
  for (const name of skills) {
    const destination = join(resolvedTarget, name);
    await rm(destination, { recursive: true, force: true });
    await cp(join(resolvedSource, name), destination, { recursive: true });
  }

  return { targetDir: resolvedTarget, skills };
}

export function formatSyncSkillsUsage(binName: string): string {
  return [
    `Usage: ${binName} sync-skills [target-dir]`,
    "",
    "Copy this package's bundled MongoDB skills into <target-dir> (default: ./skills).",
  ].join("\n");
}

/**
 * Runs a `<agent-package> sync-skills [target-dir]` CLI command and returns its
 * process exit code.
 */
export async function runSyncSkillsCli(
  options: RunSyncSkillsCliOptions,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? ((line: string) => console.log(line));
  const stderr = options.stderr ?? ((line: string) => console.error(line));
  const usage = formatSyncSkillsUsage(options.binName);

  let positionals: string[];
  let showHelp: boolean;
  try {
    const parsed = parseArgs({
      args: [...options.argv],
      options: {
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    positionals = parsed.positionals;
    showHelp = parsed.values.help;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`${message}\n\n${usage}`);
    return 1;
  }

  if (showHelp) {
    if (
      positionals.length === 0 ||
      (positionals[0] === "sync-skills" && positionals.length <= 2)
    ) {
      stdout(usage);
      return 0;
    }
  }

  const [command, targetArg, ...rest] = positionals;
  if (!command) {
    stderr(`Missing command.\n\n${usage}`);
    return 1;
  }
  if (command !== "sync-skills") {
    stderr(`Unknown command: ${command}\n\n${usage}`);
    return 1;
  }
  if (rest.length > 0) {
    stderr(`Too many arguments.\n\n${usage}`);
    return 1;
  }

  const targetDir = resolve(cwd, targetArg ?? "skills");
  try {
    const result = await syncBundledSkills({
      sourceDir: options.sourceDir,
      targetDir,
    });
    const displayPath = relative(cwd, result.targetDir) || ".";
    stdout(`Synced ${result.skills.length} skills to ${displayPath}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(message);
    return 1;
  }
}
