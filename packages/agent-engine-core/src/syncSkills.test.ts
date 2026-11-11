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
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runSkillsCli, syncSkills } from "./syncSkills.js";

let work: string;
let source: string;

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "sync-skills-"));
  source = path.join(work, "bundled");
  write(path.join(source, "skill-a", "SKILL.md"), "a v1");
  write(path.join(source, "skill-a", "references", "guide.md"), "guide");
  write(path.join(source, "skill-b", "SKILL.md"), "b v1");
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("syncSkills", () => {
  it("creates the target and copies every skill on a first run", async () => {
    const target = path.join(work, "app", "skills");

    expect(await syncSkills(source, target)).toEqual(["skill-a", "skill-b"]);
    expect(read(path.join(target, "skill-a", "SKILL.md"))).toBe("a v1");
    expect(read(path.join(target, "skill-a", "references", "guide.md"))).toBe(
      "guide",
    );
    expect(read(path.join(target, "skill-b", "SKILL.md"))).toBe("b v1");
  });

  it("replaces bundled skills on a rerun and keeps other entries", async () => {
    const target = path.join(work, "skills");
    await syncSkills(source, target);
    write(path.join(target, "skill-a", "stale.md"), "stale");
    write(path.join(target, "custom", "SKILL.md"), "mine");
    write(path.join(source, "skill-a", "SKILL.md"), "a v2");

    await syncSkills(source, target);

    expect(read(path.join(target, "skill-a", "SKILL.md"))).toBe("a v2");
    expect(fs.existsSync(path.join(target, "skill-a", "stale.md"))).toBe(false);
    expect(read(path.join(target, "custom", "SKILL.md"))).toBe("mine");
  });

  it("ignores files at the top of the bundled directory", async () => {
    write(path.join(source, "README.md"), "not a skill");
    const target = path.join(work, "skills");

    expect(await syncSkills(source, target)).toEqual(["skill-a", "skill-b"]);
    expect(fs.existsSync(path.join(target, "README.md"))).toBe(false);
  });
});

describe("runSkillsCli", () => {
  function run(argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = runSkillsCli({
      bin: "example-agent",
      skillsDir: source,
      argv,
      cwd: work,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    });
    return code.then((exitCode) => ({ exitCode, out, err }));
  }

  it("copies into ./skills by default", async () => {
    const { exitCode, out } = await run(["sync-skills"]);

    expect(exitCode).toBe(0);
    expect(read(path.join(work, "skills", "skill-b", "SKILL.md"))).toBe("b v1");
    expect(out).toEqual(["Copied 2 skills to skills: skill-a, skill-b"]);
  });

  it("copies into --dir, resolved against cwd", async () => {
    const { exitCode } = await run(["sync-skills", "--dir", "out/skills"]);

    expect(exitCode).toBe(0);
    expect(read(path.join(work, "out", "skills", "skill-a", "SKILL.md"))).toBe(
      "a v1",
    );
  });

  it("prints usage for --help", async () => {
    const { exitCode, out } = await run(["--help"]);

    expect(exitCode).toBe(0);
    expect(out.join("\n")).toContain(
      "Usage: example-agent sync-skills [--dir <path>]",
    );
  });

  it.each([
    [[]],
    [["sync"]],
    [["sync-skills", "extra"]],
    [["sync-skills", "--force"]],
  ])("fails with usage for %j", async (argv) => {
    const { exitCode, err } = await run(argv);

    expect(exitCode).toBe(1);
    expect(err.join("\n")).toContain("Usage: example-agent sync-skills");
    expect(fs.existsSync(path.join(work, "skills"))).toBe(false);
  });
});
