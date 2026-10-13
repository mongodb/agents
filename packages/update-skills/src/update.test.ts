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

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_FILE_NAME } from "./config.js";
import {
  createAgentFixture,
  snapshotTree,
  type AgentFixture,
} from "./testUtils.js";
import { isOutOfDate, LOCK_FILE_NAME, updateSkills } from "./update.js";

describe("updateSkills", () => {
  let fixture: AgentFixture;

  beforeEach(async () => {
    fixture = await createAgentFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("replaces listed skills, adds missing ones, and leaves unlisted dirs alone", async () => {
    const report = await updateSkills(fixture.agentDir, "apply");

    const snapshot = await snapshotTree(fixture.agentDir);
    expect(snapshot["skills/alpha/SKILL.md"]).toContain("# alpha upstream");
    expect(snapshot["skills/alpha/references/doc.md"]).toBe("alpha reference\n");
    expect(snapshot["skills/alpha/old.md"]).toBeUndefined();
    expect(snapshot["skills/beta/SKILL.md"]).toContain("# beta upstream");
    expect(snapshot["skills/delta/SKILL.md"]).toContain("# delta local only");

    expect(report.unlisted).toEqual(["delta"]);
    expect(report.skills.map((skill) => skill.name)).toEqual(["alpha", "beta"]);
  });

  it("does not create skills that upstream has but the config does not list", async () => {
    await updateSkills(fixture.agentDir, "apply");

    const snapshot = await snapshotTree(fixture.agentDir);
    expect(Object.keys(snapshot).some((path) => path.includes("gamma"))).toBe(
      false,
    );
  });

  it("writes only the listed skill dirs and the lock file", async () => {
    const before = await snapshotTree(fixture.agentDir);
    await updateSkills(fixture.agentDir, "apply");
    const after = await snapshotTree(fixture.agentDir);

    const changed = Object.keys({ ...before, ...after }).filter(
      (path) => before[path] !== after[path],
    );
    for (const path of changed) {
      const allowed =
        path === LOCK_FILE_NAME ||
        path.startsWith("skills/alpha/") ||
        path.startsWith("skills/beta/");
      expect(allowed, path).toBe(true);
    }
    expect(changed).toContain(LOCK_FILE_NAME);
  });

  it("writes a lock file that lists only the configured skills", async () => {
    await updateSkills(fixture.agentDir, "apply");

    const lock = JSON.parse(
      await readFile(join(fixture.agentDir, LOCK_FILE_NAME), "utf8"),
    ) as { version: number; source: string; skills: Record<string, unknown> };
    expect(lock.version).toBe(1);
    expect(lock.source).toBe(fixture.upstreamDir);
    expect(Object.keys(lock.skills).sort()).toEqual(["alpha", "beta"]);
  });

  it("dry-run reports the changes and writes nothing", async () => {
    const before = await snapshotTree(fixture.agentDir);
    const report = await updateSkills(fixture.agentDir, "dry-run");
    const after = await snapshotTree(fixture.agentDir);

    expect(after).toEqual(before);
    expect(isOutOfDate(report)).toBe(true);
    const alpha = report.skills.find((skill) => skill.name === "alpha");
    expect(alpha?.removed).toEqual(["old.md"]);
    expect(alpha?.added).toEqual(["references/doc.md"]);
  });

  it("check is out of date before apply and up to date after", async () => {
    await rm(join(fixture.agentDir, "skills/delta"), { recursive: true });
    expect(isOutOfDate(await updateSkills(fixture.agentDir, "check"))).toBe(true);

    await updateSkills(fixture.agentDir, "apply");

    const report = await updateSkills(fixture.agentDir, "check");
    expect(isOutOfDate(report)).toBe(false);
    expect(report.lock.changed).toBe(false);
  });

  it("a second apply changes nothing", async () => {
    await updateSkills(fixture.agentDir, "apply");
    const before = await snapshotTree(fixture.agentDir);

    const report = await updateSkills(fixture.agentDir, "apply");

    expect(await snapshotTree(fixture.agentDir)).toEqual(before);
    expect(report.skills.every((skill) => skill.added.length === 0)).toBe(true);
    expect(report.lock.changed).toBe(false);
  });

  it("check flags an unlisted skill dir as out of date", async () => {
    await updateSkills(fixture.agentDir, "apply");

    const report = await updateSkills(fixture.agentDir, "check");

    expect(report.unlisted).toEqual(["delta"]);
    expect(isOutOfDate(report)).toBe(true);
  });

  it("detects local edits to a listed skill in check mode", async () => {
    await updateSkills(fixture.agentDir, "apply");
    await writeFile(
      join(fixture.agentDir, "skills/beta/SKILL.md"),
      "hand edited\n",
    );

    const report = await updateSkills(fixture.agentDir, "check");

    const beta = report.skills.find((skill) => skill.name === "beta");
    expect(beta?.changed).toEqual(["SKILL.md"]);
    expect(isOutOfDate(report)).toBe(true);
  });

  it("fails without writing when a listed skill is missing upstream", async () => {
    await writeFile(
      join(fixture.agentDir, CONFIG_FILE_NAME),
      JSON.stringify({ source: fixture.upstreamDir, skills: ["alpha", "nope"] }),
    );
    const before = await snapshotTree(fixture.agentDir);

    await expect(updateSkills(fixture.agentDir, "apply")).rejects.toThrow(
      /Skill "nope" was not found/,
    );
    expect(await snapshotTree(fixture.agentDir)).toEqual(before);
  });

  it("fails before fetching when the config is not valid JSON", async () => {
    await writeFile(join(fixture.agentDir, CONFIG_FILE_NAME), "");
    await expect(updateSkills(fixture.agentDir, "apply")).rejects.toThrow(
      /not valid JSON/,
    );
  });
});
