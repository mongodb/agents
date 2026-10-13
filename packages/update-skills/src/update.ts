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

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  loadSkillsConfig,
  resolveSourceArg,
  type SkillsConfig,
} from "./config.js";
import {
  diffTrees,
  digestTree,
  hashTree,
  type FileHashes,
  type TreeDiff,
} from "./files.js";
import { withStagedSkills } from "./stage.js";

export const LOCK_FILE_NAME = "skills.lock.json";

export type UpdateMode = "apply" | "dry-run" | "check";

export interface SkillReport extends TreeDiff {
  name: string;
}

export interface UpdateReport {
  skills: SkillReport[];
  unlisted: string[];
  lock: { changed: boolean };
}

export function hasChanges(diff: TreeDiff): boolean {
  return diff.added.length + diff.changed.length + diff.removed.length > 0;
}

export function isOutOfDate(report: UpdateReport): boolean {
  return (
    report.skills.some(hasChanges) ||
    report.lock.changed ||
    report.unlisted.length > 0
  );
}

async function listUnlistedSkillDirs(
  agentDir: string,
  listed: string[],
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(agentDir, "skills"), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !listed.includes(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

function renderLock(
  config: SkillsConfig,
  upstreamByName: Map<string, FileHashes>,
): string {
  const skills = Object.fromEntries(
    [...upstreamByName.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, hashes]) => [name, { sha256: digestTree(hashes) }]),
  );
  const lock = {
    version: 1,
    source: config.source,
    ...(config.ref ? { ref: config.ref } : {}),
    skills,
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function replaceSkillDir(target: string, source: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

/**
 * Re-vendors the skills listed in `<agentDir>/skills.config.json`.
 *
 * Everything is fetched and compared before anything is written. Only listed
 * skill directories and the lock file can change, and only in `apply` mode.
 */
export async function updateSkills(
  agentDir: string,
  mode: UpdateMode,
): Promise<UpdateReport> {
  const config = await loadSkillsConfig(agentDir);
  const sourceArg = resolveSourceArg(config, agentDir);
  const unlisted = await listUnlistedSkillDirs(agentDir, config.skills);

  return withStagedSkills(sourceArg, config.skills, async (stagedDirs) => {
    const upstreamByName = new Map<string, FileHashes>();
    const skills: SkillReport[] = [];
    const dirsToReplace: [name: string, stagedDir: string][] = [];

    for (const [name, stagedDir] of stagedDirs) {
      const upstream = await hashTree(stagedDir);
      const local = await hashTree(join(agentDir, "skills", name));
      const diff = diffTrees(upstream, local);
      upstreamByName.set(name, upstream);
      skills.push({ name, ...diff });
      if (hasChanges(diff)) {
        dirsToReplace.push([name, stagedDir]);
      }
    }

    const lockPath = join(agentDir, LOCK_FILE_NAME);
    const lockContent = renderLock(config, upstreamByName);
    const lockChanged = (await readOptional(lockPath)) !== lockContent;

    if (mode === "apply") {
      for (const [name, stagedDir] of dirsToReplace) {
        await replaceSkillDir(join(agentDir, "skills", name), stagedDir);
      }
      if (lockChanged) {
        await writeFile(lockPath, lockContent);
      }
    }

    return { skills, unlisted, lock: { changed: lockChanged } };
  });
}
