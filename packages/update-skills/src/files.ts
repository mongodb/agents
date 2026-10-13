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

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export type FileHashes = Map<string, string>;

export interface TreeDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function hashTree(root: string): Promise<FileHashes> {
  const hashes: FileHashes = new Map();

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relativePath = relative(root, fullPath).split(sep).join("/");
        hashes.set(relativePath, sha256(await readFile(fullPath)));
      }
    }
  }

  try {
    await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return hashes;
}

export function diffTrees(from: FileHashes, to: FileHashes): TreeDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [path, hash] of from) {
    const current = to.get(path);
    if (current === undefined) {
      added.push(path);
    } else if (current !== hash) {
      changed.push(path);
    }
  }
  for (const path of to.keys()) {
    if (!from.has(path)) {
      removed.push(path);
    }
  }

  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
  };
}

export function digestTree(hashes: FileHashes): string {
  const lines = [...hashes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, hash]) => `${path}\0${hash}\n`);
  return sha256(lines.join(""));
}
