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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mcpTokenCacheFile,
  readMcpTokenCacheSummary,
  startRuntimeDiagnostics,
  type RuntimeDiagnostics,
} from "./runtimeDiagnostics.js";

const server = { name: "mongodb", url: "https://mcp.example.test" };

function writeCache(accessToken: string): void {
  const file = mcpTokenCacheFile(server);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      updated_at: "2026-10-07T12:00:00.000Z",
      tokens: { access_token: accessToken, expiry: "2026-10-07T13:00:00.000Z" },
    }),
  );
}

describe("runtime diagnostics", () => {
  let cacheDir: string;
  let previousCacheDir: string | undefined;
  let diagnostics: RuntimeDiagnostics | undefined;
  let lines: string[];

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-diag-"));
    previousCacheDir = process.env["AGENTIC_MCP_OAUTH_DIR"];
    process.env["AGENTIC_MCP_OAUTH_DIR"] = cacheDir;
    lines = [];
  });

  afterEach(() => {
    diagnostics?.stop();
    diagnostics = undefined;
    vi.restoreAllMocks();
    if (previousCacheDir === undefined) {
      delete process.env["AGENTIC_MCP_OAUTH_DIR"];
    } else {
      process.env["AGENTIC_MCP_OAUTH_DIR"] = previousCacheDir;
    }
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("summarizes a cached token without exposing it", () => {
    writeCache("secret-token-value");

    const summary = readMcpTokenCacheSummary(mcpTokenCacheFile(server));

    expect(summary).toEqual({
      fingerprint: expect.stringMatching(/^[0-9a-f]{12}$/),
      expiry: "2026-10-07T13:00:00.000Z",
      updatedAt: "2026-10-07T12:00:00.000Z",
    });
    expect(JSON.stringify(summary)).not.toContain("secret-token-value");
  });

  it("ignores a missing or malformed cache file", () => {
    expect(readMcpTokenCacheSummary(mcpTokenCacheFile(server))).toBeUndefined();

    fs.writeFileSync(mcpTokenCacheFile(server), "{not json");
    expect(readMcpTokenCacheSummary(mcpTokenCacheFile(server))).toBeUndefined();
  });

  it("logs process start, executions, and each newly cached token once", () => {
    diagnostics = startRuntimeDiagnostics({
      mcpServers: { [server.name]: { url: server.url } },
      log: (msg) => lines.push(msg),
      pollIntervalMs: 60_000,
    });

    expect(lines).toEqual([
      expect.stringMatching(/process_start .*mcp_token_cache=mongodb:absent/),
    ]);

    writeCache("token-one");
    diagnostics.recordExecution("session-1");
    diagnostics.recordExecution("session-1");
    writeCache("token-two");
    diagnostics.checkTokenCaches();

    const events = lines.slice(1).map((line) => line.split(" ")[3]);
    expect(events).toEqual([
      "mcp_token_cached",
      "execution",
      "execution",
      "mcp_token_cached",
    ]);
    expect(lines[1]).toContain(`instance=${diagnostics.instanceId}`);
    expect(lines[2]).toContain("execution n=1 session=session-1");
    expect(lines[3]).toContain("execution n=2 session=session-1");
    expect(lines[4]).toContain("mcp_token_cached server=mongodb n=2");
    expect(lines.join("\n")).not.toMatch(/token-one|token-two/);
  });

  function start(): RuntimeDiagnostics {
    return startRuntimeDiagnostics({
      mcpServers: { [server.name]: { url: server.url } },
      log: (msg) => lines.push(msg),
      pollIntervalMs: 60_000,
    });
  }

  function withoutOtherListeners(signal: NodeJS.Signals, run: () => void): void {
    const otherListeners = process.listeners(signal);
    process.removeAllListeners(signal);
    try {
      run();
    } finally {
      process.removeAllListeners(signal);
      for (const listener of otherListeners) {
        process.on(signal, listener);
      }
    }
  }

  it("logs a signal and leaves termination to the runner's handler", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const runnerDrain = vi.fn();
    withoutOtherListeners("SIGTERM", () => {
      diagnostics = start();
      process.once("SIGTERM", runnerDrain);
      diagnostics.recordExecution("session-1");
      process.emit("SIGTERM", "SIGTERM");
    });

    expect(lines.at(-1)).toMatch(
      /signal_received signal=SIGTERM uptime=\d+s executions=1 graph_builds=0 tokens_seen=0$/,
    );
    expect(runnerDrain).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
  });

  it("re-raises a signal that arrives before the runner installs its handler", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    withoutOtherListeners("SIGINT", () => {
      diagnostics = start();
      process.emit("SIGINT", "SIGINT");
    });

    expect(lines.at(-1)).toContain("signal_received signal=SIGINT");
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGINT");
  });

  it("logs process exit ahead of other exit listeners, including late tokens", () => {
    diagnostics = start();
    writeCache("late-token");

    const onExit = process.listeners("exit")[0] as (code: number) => void;
    onExit(0);

    expect(lines.slice(-2)).toEqual([
      expect.stringContaining("mcp_token_cached server=mongodb n=1"),
      expect.stringMatching(/process_exit code=0 .*tokens_seen=1$/),
    ]);
  });
});
