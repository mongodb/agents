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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUNDLED_SKILLS_DIR } from "./skills.js";

const bundled = fs
  .readdirSync(BUNDLED_SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let cwd: string;
let argv: string[];

async function runCli(...args: string[]) {
  process.argv = [process.execPath, "atlas-explorer-agent", ...args];
  vi.resetModules();
  await import("./cli.js");
  const code = process.exitCode;
  process.exitCode = undefined;
  return code;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-explorer-agent-cli-"));
  argv = process.argv;
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.argv = argv;
  vi.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("atlas-explorer-agent sync-skills", () => {
  it("bundles the 8 skills listed in skills.config.json", () => {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(BUNDLED_SKILLS_DIR, "..", "skills.config.json"),
        "utf8",
      ),
    ) as { skills: string[] };

    expect(bundled).toHaveLength(8);
    expect(bundled).toEqual([...config.skills].sort());
  });

  it("creates ./skills on a first run", async () => {
    expect(await runCli("sync-skills")).toBe(0);

    for (const skill of bundled) {
      expect(fs.existsSync(path.join(cwd, "skills", skill, "SKILL.md"))).toBe(
        true,
      );
    }
  });

  it("refreshes an existing ./skills on a rerun", async () => {
    await runCli("sync-skills");
    const skillFile = path.join(cwd, "skills", bundled[0], "SKILL.md");
    fs.writeFileSync(skillFile, "edited");
    fs.mkdirSync(path.join(cwd, "skills", "custom"));

    expect(await runCli("sync-skills")).toBe(0);

    expect(fs.readFileSync(skillFile, "utf8")).toBe(
      fs.readFileSync(
        path.join(BUNDLED_SKILLS_DIR, bundled[0], "SKILL.md"),
        "utf8",
      ),
    );
    expect(fs.existsSync(path.join(cwd, "skills", "custom"))).toBe(true);
  });

  it("exits 1 for an unknown command", async () => {
    expect(await runCli("sync")).toBe(1);
    expect(fs.existsSync(path.join(cwd, "skills"))).toBe(false);
  });
});
