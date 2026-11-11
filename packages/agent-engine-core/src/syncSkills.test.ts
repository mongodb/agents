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

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runSyncSkillsCli, syncBundledSkills } from "./syncSkills.js";

async function writeSkill(
  root: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, name, relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
}

describe("syncBundledSkills", () => {
  let root: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sync-skills-test-"));
    sourceDir = join(root, "pkg", "skills");
    targetDir = join(root, "consumer", "skills");

    await writeSkill(sourceDir, "mongodb-beta", {
      "SKILL.md": "---\nname: mongodb-beta\n---\nBeta skill\n",
      "references/guide.md": "Beta guide\n",
    });
    await writeSkill(sourceDir, "mongodb-alpha", {
      "SKILL.md": "---\nname: mongodb-alpha\n---\nAlpha skill\n",
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("copies bundled skill directories and returns sorted skill names", async () => {
    const result = await syncBundledSkills({ sourceDir, targetDir });

    expect(result).toEqual({
      targetDir,
      skills: ["mongodb-alpha", "mongodb-beta"],
    });
    await expect(
      readFile(join(targetDir, "mongodb-alpha", "SKILL.md"), "utf8"),
    ).resolves.toContain("Alpha skill");
    await expect(
      readFile(join(targetDir, "mongodb-beta", "references", "guide.md"), "utf8"),
    ).resolves.toBe("Beta guide\n");
  });

  it("removes stale files inside replaced bundled skills while keeping custom skills", async () => {
    await writeSkill(targetDir, "mongodb-beta", {
      "SKILL.md": "old beta\n",
      "references/obsolete.md": "stale\n",
    });
    await writeSkill(targetDir, "custom-domain-skill", {
      "SKILL.md": "---\nname: custom-domain-skill\n---\nCustom\n",
    });

    await syncBundledSkills({ sourceDir, targetDir });

    await expect(
      readFile(join(targetDir, "mongodb-beta", "SKILL.md"), "utf8"),
    ).resolves.toContain("Beta skill");
    await expect(
      readFile(join(targetDir, "mongodb-beta", "references", "obsolete.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(targetDir, "custom-domain-skill", "SKILL.md"), "utf8"),
    ).resolves.toContain("Custom");
  });

  it("refuses overlapping source and target paths including via symlinks", async () => {
    await expect(
      syncBundledSkills({ sourceDir, targetDir: sourceDir }),
    ).rejects.toThrow(/overlapping path/);
    await expect(
      syncBundledSkills({ sourceDir, targetDir: join(sourceDir, "nested") }),
    ).rejects.toThrow(/overlapping path/);
    await expect(
      syncBundledSkills({ sourceDir, targetDir: join(root, "pkg") }),
    ).rejects.toThrow(/overlapping path/);

    const linkedPkg = join(root, "linked-pkg");
    await symlink(join(root, "pkg"), linkedPkg);
    await expect(
      syncBundledSkills({
        sourceDir,
        targetDir: join(linkedPkg, "skills"),
      }),
    ).rejects.toThrow(/overlapping path/);
  });

  it("fails when source directory is missing, empty, or lacks SKILL.md", async () => {
    await expect(
      syncBundledSkills({
        sourceDir: join(root, "does-not-exist"),
        targetDir,
      }),
    ).rejects.toThrow(/not found/);

    const emptySource = join(root, "empty-skills");
    await mkdir(emptySource, { recursive: true });
    await expect(
      syncBundledSkills({ sourceDir: emptySource, targetDir }),
    ).rejects.toThrow(/No bundled skills/);

    const brokenSource = join(root, "broken-skills");
    await mkdir(join(brokenSource, "broken-skill"), { recursive: true });
    await expect(
      syncBundledSkills({ sourceDir: brokenSource, targetDir }),
    ).rejects.toThrow(/missing SKILL\.md/);
  });
});

describe("runSyncSkillsCli", () => {
  let root: string;
  let sourceDir: string;
  let consumerDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sync-skills-cli-"));
    sourceDir = join(root, "pkg", "skills");
    consumerDir = join(root, "consumer");
    await mkdir(consumerDir, { recursive: true });
    await writeSkill(sourceDir, "mongodb-alpha", {
      "SKILL.md": "---\nname: mongodb-alpha\n---\nAlpha\n",
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("syncs into ./skills by default and supports a custom target directory", async () => {
    const out: string[] = [];
    const err: string[] = [];

    const code = await runSyncSkillsCli({
      binName: "example-agent",
      sourceDir,
      argv: ["sync-skills"],
      cwd: consumerDir,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual(["Synced 1 skills to skills"]);
    await expect(
      readFile(join(consumerDir, "skills", "mongodb-alpha", "SKILL.md"), "utf8"),
    ).resolves.toContain("Alpha");

    const customCode = await runSyncSkillsCli({
      binName: "example-agent",
      sourceDir,
      argv: ["sync-skills", "build/skills"],
      cwd: consumerDir,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });

    expect(customCode).toBe(0);
    await expect(
      readFile(
        join(consumerDir, "build", "skills", "mongodb-alpha", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain("Alpha");
  });

  it("prints help and exits 0 for --help and sync-skills --help", async () => {
    for (const argv of [["--help"], ["-h"], ["sync-skills", "--help"]]) {
      const out: string[] = [];
      const code = await runSyncSkillsCli({
        binName: "example-agent",
        sourceDir,
        argv,
        cwd: consumerDir,
        stdout: (line) => out.push(line),
        stderr: () => {},
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain(
        "Usage: example-agent sync-skills [target-dir]",
      );
    }
  });

  it("exits 1 with usage on missing, unknown, or invalid arguments", async () => {
    for (const argv of [
      [],
      ["unknown"],
      ["unknown", "--help"],
      ["sync-skills", "a", "b"],
      ["sync-skills", "--nope"],
    ]) {
      const err: string[] = [];
      const code = await runSyncSkillsCli({
        binName: "example-agent",
        sourceDir,
        argv,
        cwd: consumerDir,
        stdout: () => {},
        stderr: (line) => err.push(line),
      });
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("Usage: example-agent sync-skills");
    }
  });
});
