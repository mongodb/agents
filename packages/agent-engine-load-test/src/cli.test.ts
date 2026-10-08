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

import { describe, expect, it } from "vitest";

import {
  createCli,
  normalizeArgv,
  type LoadCommandOptions,
  type WindowCommandOptions,
} from "./cli.js";

describe("createCli", () => {
  it("sends each command to its handler with the parsed options", async () => {
    const loads: LoadCommandOptions[] = [];
    const fetches: WindowCommandOptions[] = [];
    const reports: WindowCommandOptions[] = [];
    const cli = createCli({
      load: (options) => {
        loads.push(options);
      },
      fetchLogs: (options) => {
        fetches.push(options);
      },
      report: (options) => {
        reports.push(options);
      },
    });

    await cli.parseAsync([
      "load",
      "--scenario",
      "same-session",
      "--gap",
      "30s",
      "--run-id",
      "phase0",
    ]);
    await cli.parseAsync([
      "fetch-logs",
      "--run",
      "phase0",
      "--workspace",
      "atlas-explorer",
    ]);
    await cli.parseAsync([
      "report",
      "--since",
      "2026-10-07T16:55:00.000Z",
      "--until",
      "2026-10-07T17:30:00.000Z",
    ]);

    expect(loads).toEqual([
      {
        scenario: "same-session",
        gap: "30s",
        runId: "phase0",
        workspace: "atlas-explorer",
      },
    ]);
    expect(fetches).toEqual([
      { runId: "phase0", workspace: "atlas-explorer" },
    ]);
    // No --workspace given, so the window commands do not inject a default.
    expect(reports).toEqual([
      {
        since: "2026-10-07T16:55:00.000Z",
        until: "2026-10-07T17:30:00.000Z",
      },
    ]);
  });

  it("rejects an unknown option", async () => {
    const cli = createCli({
      load: () => undefined,
      fetchLogs: () => undefined,
      report: () => undefined,
    });

    const unknown = await rejected(cli, [
      "load",
      "--scenario",
      "same-session",
      "--bogus",
    ]);
    expect(unknown.message).toMatch(/bogus|Unknown argument/i);
  });

  it("requires a command", async () => {
    const cli = createCli({
      load: () => undefined,
      fetchLogs: () => undefined,
      report: () => undefined,
    });

    const missing = await rejected(cli, []);
    expect(missing.message).toMatch(/command/i);
  });

  it("drops the extra -- that pnpm inserts before flags", () => {
    expect(
      normalizeArgv([
        "report",
        "--",
        "--since",
        "2026-10-07T16:55:00.000Z",
      ]),
    ).toEqual(["report", "--since", "2026-10-07T16:55:00.000Z"]);
  });
});

async function rejected(
  cli: ReturnType<typeof createCli>,
  argv: string[],
): Promise<Error> {
  try {
    await cli.parseAsync(argv);
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
  throw new Error("parseAsync did not fail");
}
