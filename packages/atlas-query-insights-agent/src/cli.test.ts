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

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ATLAS_QUERY_INSIGHTS_SKILLS_DIR,
  runAtlasQueryInsightsCli,
} from "./cliRunner.js";
import { buildSystemPrompt } from "./systemMessage.js";

describe("atlas-query-insights-agent sync-skills", () => {
  let consumerDir: string;

  beforeEach(async () => {
    consumerDir = await mkdtemp(join(tmpdir(), "query-insights-sync-skills-"));
  });

  afterEach(async () => {
    await rm(consumerDir, { recursive: true, force: true });
  });

  it("bundles the skills declared in skills.config.json and syncs them into ./skills", async () => {
    const config = JSON.parse(
      await readFile(
        fileURLToPath(new URL("../skills.config.json", import.meta.url)),
        "utf8",
      ),
    ) as { skills: string[] };

    const bundled = (
      await readdir(ATLAS_QUERY_INSIGHTS_SKILLS_DIR, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
    expect(bundled).toEqual([...config.skills].sort());

    const prompt = buildSystemPrompt();
    for (const skill of config.skills) {
      expect(prompt).toContain(`\`${skill}\``);
    }

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runAtlasQueryInsightsCli(["sync-skills"], {
      cwd: consumerDir,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([`Synced ${config.skills.length} skills to skills`]);

    for (const skill of config.skills) {
      const content = await readFile(
        join(consumerDir, "skills", skill, "SKILL.md"),
        "utf8",
      );
      expect(content).toContain(`name: ${skill}`);
    }
  });
});
