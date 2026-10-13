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

import { basename, dirname } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCli } from "./command.js";
import { createAgentFixture, type AgentFixture } from "./testUtils.js";

describe("runCli", () => {
  let fixture: AgentFixture;
  let logged: string[];

  beforeEach(async () => {
    fixture = await createAgentFixture({ includeUnlisted: false });
    logged = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logged.push(String(line ?? ""));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.cleanup();
  });

  it("exits 1 from --check while the skills are out of date", async () => {
    const exitCode = await runCli([fixture.agentDir, "--check"], "/");

    expect(exitCode).toBe(1);
    expect(logged.join("\n")).toContain("Out of date.");
  });

  it("exits 0 from --check once the skills are applied", async () => {
    expect(await runCli([fixture.agentDir], "/")).toBe(0);
    expect(await runCli([fixture.agentDir, "--check"], "/")).toBe(0);
    expect(logged.join("\n")).toContain("All listed skills match upstream.");
  });

  it("exits 0 from --dry-run and says nothing was written", async () => {
    expect(await runCli([fixture.agentDir, "--dry-run"], "/")).toBe(0);
    expect(logged.join("\n")).toContain("Dry run: no files were written.");
  });

  it("rejects --dry-run combined with --check", async () => {
    await expect(
      runCli([fixture.agentDir, "--dry-run", "--check"], "/"),
    ).rejects.toThrow(/either --dry-run or --check/);
  });

  it("resolves a relative agent directory against the base directory", async () => {
    const baseDir = dirname(fixture.agentDir);
    const relativeAgent = basename(fixture.agentDir);

    expect(await runCli([relativeAgent], baseDir)).toBe(0);
    expect(logged.join("\n")).toContain("skills/alpha");
    expect(await runCli([relativeAgent, "--check"], baseDir)).toBe(0);
  });
});
