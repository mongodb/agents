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

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

export type TreeSnapshot = Record<string, string>;

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

export async function writeTree(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }
}

export async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const snapshot: TreeSnapshot = {};

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relativePath = relative(root, fullPath).split(sep).join("/");
        snapshot[relativePath] = await readFile(fullPath, "utf8");
      }
    }
  }

  await walk(root);
  return snapshot;
}

export function skillMarkdown(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`;
}

export interface AgentFixture {
  root: string;
  upstreamDir: string;
  agentDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Builds a local "upstream" with alpha, beta and gamma, and an agent that lists
 * alpha and beta. The agent also holds a stale alpha file and, unless
 * `includeUnlisted` is false, an unlisted skill, delta. Passing the upstream
 * path as `source` keeps tests offline.
 */
export async function createAgentFixture(
  options: { listed?: string[]; includeUnlisted?: boolean } = {},
): Promise<AgentFixture> {
  const includeUnlisted = options.includeUnlisted ?? true;
  const root = await makeTempDir("update-skills-fixture");
  const upstreamDir = join(root, "upstream");
  const agentDir = join(root, "agent");

  await writeTree(upstreamDir, {
    "skills/alpha/SKILL.md": skillMarkdown("alpha", "# alpha upstream"),
    "skills/alpha/references/doc.md": "alpha reference\n",
    "skills/beta/SKILL.md": skillMarkdown("beta", "# beta upstream"),
    "skills/gamma/SKILL.md": skillMarkdown("gamma", "# gamma upstream"),
  });

  await writeTree(agentDir, {
    "skills.config.json": `${JSON.stringify(
      {
        source: upstreamDir,
        skills: options.listed ?? ["alpha", "beta"],
      },
      null,
      2,
    )}\n`,
    "skills/alpha/SKILL.md": skillMarkdown("alpha", "# alpha stale"),
    "skills/alpha/old.md": "removed upstream\n",
    ...(includeUnlisted
      ? { "skills/delta/SKILL.md": skillMarkdown("delta", "# delta local only") }
      : {}),
  });

  return {
    root,
    upstreamDir,
    agentDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
