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

import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { inheritedEnv, stopProcess } from "./startMcpServer.js";

const saved = { ...process.env };

afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (!(name in saved)) delete process.env[name];
  }
  Object.assign(process.env, saved);
});

describe("inheritedEnv", () => {
  it("drops the server's own settings and keeps the rest", () => {
    process.env.MDB_MCP_CONNECTION_STRING = "mongodb://prod.example.com";
    process.env.mdb_mcp_api_client_id = "real-client";
    process.env.EVAL_UNRELATED = "kept";

    const env = inheritedEnv();

    expect(Object.keys(env).filter((n) => /^mdb_mcp_/i.test(n))).toEqual([]);
    expect(env.EVAL_UNRELATED).toBe("kept");
  });
});

describe("stopProcess", () => {
  const idle = () =>
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });

  it("stops a running process", async () => {
    const child = idle();
    await stopProcess(child);

    expect(child.signalCode ?? child.exitCode).not.toBeNull();
  });

  it("returns for a process that was already killed by a signal", async () => {
    const child = idle();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;

    expect(child.exitCode).toBeNull();
    await stopProcess(child);
  });
});
