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
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  fetchLogs,
  type CommandResult,
  type CommandRunner,
  splitLogWindow,
} from "./fetchLogs.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

describe("splitLogWindow", () => {
  it("returns one window when the range is at most six hours", () => {
    const since = new Date("2026-10-07T00:00:00.000Z");
    const until = new Date(since.getTime() + SIX_HOURS_MS);

    expect(splitLogWindow(since, until)).toEqual([{ since, until }]);
  });

  it("splits a longer range into windows of at most six hours", () => {
    const since = new Date("2026-10-07T00:00:00.000Z");
    const until = new Date("2026-10-07T15:00:00.000Z");
    const windows = splitLogWindow(since, until);

    expect(windows).toHaveLength(3);
    expect(windows[0]?.since.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(windows[0]?.until.toISOString()).toBe("2026-10-07T06:00:00.000Z");
    expect(windows[2]?.until.toISOString()).toBe("2026-10-07T15:00:00.000Z");
    for (const window of windows) {
      expect(window.until.getTime() - window.since.getTime()).toBeLessThanOrEqual(
        SIX_HOURS_MS,
      );
    }
  });

  it("returns nothing when the range is empty", () => {
    const at = new Date("2026-10-07T00:00:00.000Z");
    expect(splitLogWindow(at, at)).toEqual([]);
  });
});

describe("fetchLogs", () => {
  it("queries both greps for every window and writes deduped ndjson", async () => {
    const calls: string[][] = [];
    const diag = JSON.stringify({
      timestamp: "2026-10-07T01:00:00.000Z",
      message:
        "[runtime-diag] instance=aaaaaaaa mode=aer process_start pid=1 host=fctr mcp_token_cache=mongodb:absent",
      service: "agent",
    });
    const repeated = JSON.stringify({
      timestamp: "2026-10-07T01:00:00.000Z",
      message:
        "[runtime-diag] instance=aaaaaaaa mode=aer process_start pid=1 host=fctr mcp_token_cache=mongodb:absent",
      service: "agent",
    });
    const limit = JSON.stringify({
      timestamp: "2026-10-07T02:00:00.000Z",
      message: "Access Token limit reached",
      service: "agent",
    });
    const runner: CommandRunner = {
      async run(args) {
        calls.push(args);
        const grep = args[args.indexOf("--grep") + 1];
        const body =
          grep === "runtime-diag"
            ? `context: example\n${diag}\n${repeated}`
            : limit;
        return { stdout: body, stderr: "", exitCode: 0 };
      },
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-logs-"));
    const outFile = path.join(dir, "logs.ndjson");

    try {
      await fetchLogs({
        since: new Date("2026-10-07T00:00:00.000Z"),
        until: new Date("2026-10-07T15:00:00.000Z"),
        workspace: "atlas-explorer",
        outFile,
        runner,
      });
    } finally {
      // removed below after assertions; kept if the assertion throws
    }

    expect(calls).toHaveLength(6);
    expect(calls[0]).toEqual([
      "agentengine",
      "--no-log",
      "logs",
      "--json",
      "--all",
      "--workspace",
      "atlas-explorer",
      "--since",
      "2026-10-07T00:00:00.000Z",
      "--until",
      "2026-10-07T06:00:00.000Z",
      "--grep",
      "runtime-diag",
    ]);
    expect(calls.filter((args) => args.includes("runtime-diag"))).toHaveLength(3);
    expect(
      calls.filter((args) => args.includes("Access Token limit")),
    ).toHaveLength(3);

    const lines = fs.readFileSync(outFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the CLI fails or a page is truncated", async () => {
    const failing: CommandRunner = {
      async run() {
        return { stdout: "", stderr: "unavailable", exitCode: 1 };
      },
    };
    await expect(
      fetchLogs({
        since: new Date("2026-10-07T00:00:00.000Z"),
        until: new Date("2026-10-07T01:00:00.000Z"),
        workspace: "atlas-explorer",
        outFile: path.join(os.tmpdir(), "unused.ndjson"),
        runner: failing,
      }),
    ).rejects.toThrow(/unavailable/);

    const truncated: CommandRunner = {
      async run(): Promise<CommandResult> {
        return {
          stdout: JSON.stringify({ logs: [], hasMore: true }),
          stderr: "",
          exitCode: 0,
        };
      },
    };
    await expect(
      fetchLogs({
        since: new Date("2026-10-07T00:00:00.000Z"),
        until: new Date("2026-10-07T01:00:00.000Z"),
        workspace: "atlas-explorer",
        outFile: path.join(os.tmpdir(), "unused.ndjson"),
        runner: truncated,
      }),
    ).rejects.toThrow(/truncated/);
  });
});
