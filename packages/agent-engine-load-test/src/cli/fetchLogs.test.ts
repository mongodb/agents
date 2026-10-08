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

import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandResult, CommandRunner } from "../logs/fetchLogs.js";
import { runDirectory } from "../paths.js";
import { runFetchLogs } from "./fetchLogs.js";
import { readRunMeta, writeRunMeta } from "./meta.js";

const PAD_MS = 2 * 60 * 1000;

let runId: string;
let calls: string[][];

function silentRunner(): CommandRunner {
  return {
    run: async (args: string[]): Promise<CommandResult> => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
}

function seedRun(workspace = "atlas-explorer"): void {
  writeRunMeta(runDirectory(runId), {
    runId,
    workspace,
    since: "2026-10-08T12:00:00.000Z",
    until: "2026-10-08T12:30:00.000Z",
    orchestrationEngineImage: null,
    engineImageObservedAt: null,
  });
}

beforeEach(() => {
  runId = `fetch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  calls = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  fs.rmSync(runDirectory(runId), { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runFetchLogs --run", () => {
  it("pads from the load end on every fetch, so repeats do not widen the window", async () => {
    seedRun();

    await runFetchLogs({ runId }, silentRunner());
    await runFetchLogs({ runId }, silentRunner());

    const meta = readRunMeta(runDirectory(runId));
    expect(meta.until).toBe("2026-10-08T12:30:00.000Z");
    expect(meta.logWindow).toEqual({
      since: "2026-10-08T12:00:00.000Z",
      until: new Date(Date.parse("2026-10-08T12:30:00.000Z") + PAD_MS).toISOString(),
    });
    const last = calls.at(-1) ?? [];
    expect(last[last.indexOf("--until") + 1]).toBe(meta.logWindow?.until);
  });

  it("uses the workspace stored by load when --workspace is omitted", async () => {
    seedRun("dedicated-workspace");

    await runFetchLogs({ runId }, silentRunner());

    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(args[args.indexOf("--workspace") + 1]).toBe("dedicated-workspace");
    }
  });

  it("rejects an explicit --workspace that differs from the run's", async () => {
    seedRun("dedicated-workspace");

    await expect(
      runFetchLogs({ runId, workspace: "atlas-explorer" }, silentRunner()),
    ).rejects.toThrow(/loaded against workspace dedicated-workspace/);
    expect(calls).toHaveLength(0);
  });
});
