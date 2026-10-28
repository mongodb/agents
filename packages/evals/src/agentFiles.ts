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

import fs from "node:fs";
import path from "node:path";

import type { FileData } from "deepagents";

const cache = new Map<string, Record<string, FileData>>();

/**
 * The agent's `skills/` directory as files for deepagents' in-memory
 * `StateBackend`, keyed by absolute virtual path (`/skills/<name>/SKILL.md`).
 * Seeding the files means a case never gets a handle on the real disk. The
 * agent can still write, but only into its own case's memory.
 *
 * Read once per directory. Skills are small markdown files.
 */
export function readAgentFiles(agentDir: string): Record<string, FileData> {
  const cached = cache.get(agentDir);
  if (cached) return cached;

  const files: Record<string, FileData> = {};
  const walk = (relative: string) => {
    const dir = path.join(agentDir, relative);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile()) {
        const stat = fs.statSync(path.join(agentDir, child));
        files[`/${child}`] = {
          content: fs.readFileSync(path.join(agentDir, child), "utf8"),
          mimeType: "text/plain",
          created_at: stat.birthtime.toISOString(),
          modified_at: stat.mtime.toISOString(),
        };
      }
    }
  };
  walk("skills");

  cache.set(agentDir, files);
  return files;
}
