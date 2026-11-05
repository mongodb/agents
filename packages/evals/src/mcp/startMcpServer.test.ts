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
import net from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  inheritedEnv,
  parseListeningPort,
  startMcpServer,
  stopProcess,
  type McpServerProcess,
} from "./startMcpServer.js";

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

describe("parseListeningPort", () => {
  it("reads the port from the server's address line", () => {
    expect(
      parseListeningPort(
        "[INFO] 1006100 - mcpHttpServer: Http server started on address: http://127.0.0.1:36703\n",
      ),
    ).toBe(36703);
  });

  it("ignores the other output around the line", () => {
    const output = [
      "[INFO] 1006000 - streamableHttpTransport: Starting transport",
      "[INFO] 1006100 - mcpHttpServer: Http server started on address: http://127.0.0.1:1",
      "[INFO] 1006001 - streamableHttpTransport: Streamable HTTP Transport started",
    ].join("\n");
    expect(parseListeningPort(output)).toBe(1);
  });

  it("is undefined before the line appears", () => {
    expect(parseListeningPort("")).toBeUndefined();
    expect(
      parseListeningPort("Fatal error running server: Error: listen EADDRINUSE"),
    ).toBeUndefined();
  });
});

describe("startMcpServer", () => {
  it("binds port 0 and reports the port the server actually listens on", async () => {
    const server = await startMcpServer();
    try {
      const bound = Number(new URL(server.url).port);
      // The server's own log line, which is where the port came from.
      expect(parseListeningPort(server.output())).toBe(bound);
      expect(bound).toBeGreaterThan(0);

      // An MCP session on that port proves the number is this server's
      // listener, not a port lifted from unrelated output.
      const client = new Client({ name: "port-test", version: "1.0.0" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(server.url)),
        );
        expect(server.output()).toContain(
          `Http server started on address: http://127.0.0.1:${bound}`,
        );
      } finally {
        await client.close();
      }
    } finally {
      await server.stop();
    }
  });

  it("starts 20 servers at once, each on its own port and answering /health", async () => {
    const servers: McpServerProcess[] = [];
    try {
      servers.push(
        ...(await Promise.all(
          Array.from({ length: 20 }, () => startMcpServer()),
        )),
      );
      const ports = servers.map((s) => Number(new URL(s.url).port));
      expect(new Set(ports).size).toBe(20);

      // The server has no `/health` route, so a 404 is a healthy answer here:
      // the readiness check only needs the listener to accept connections.
      const answered = await Promise.all(
        ports.map(async (port) => {
          const response = await fetch(`http://127.0.0.1:${port}/health`);
          return response.status > 0;
        }),
      );
      expect(answered).toEqual(Array.from({ length: 20 }, () => true));
    } finally {
      await Promise.all(servers.map((s) => s.stop()));
    }
  }, 120_000);

  it("fails with the captured output when the address line never appears", async () => {
    // 1 ms is less than the server needs to log its address, so the wait
    // times out with the line still missing. The error has to carry the
    // captured output, because the wording of that line is a pinned
    // dependency's and an upgrade can change it.
    await expect(
      startMcpServer({ startTimeoutMs: 1 }),
    ).rejects.toThrow(/did not log[\s\S]*Output so far:/);
  }, 30_000);

  it("starts even when another process already holds a port", async () => {
    // The old harness probed for a port, closed the probe, and started the
    // child against that number later, so anything that took the number in
    // between failed the start with EADDRINUSE. This holds a port and checks
    // both halves: binding it again fails exactly as the child did, and the
    // harness still starts fine because its child asks the OS for a port.
    const squatter = net.createServer();
    await new Promise<void>((resolve) =>
      squatter.listen(0, "127.0.0.1", () => resolve()),
    );
    const held = (squatter.address() as net.AddressInfo).port;
    try {
      // Negative control: the port really is taken, so a child pinned to it
      // would fail the way the ticket's log shows.
      const clash = net.createServer();
      await expect(
        new Promise((resolve, reject) => {
          clash.once("error", reject);
          clash.listen(held, "127.0.0.1", () => resolve(undefined));
        }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
      clash.close();

      const server = await startMcpServer();
      try {
        expect(Number(new URL(server.url).port)).not.toBe(held);
        const client = new Client({ name: "squat-test", version: "1.0.0" });
        try {
          // The server is usable, so it bound a port of its own.
          await client.connect(
            new StreamableHTTPClientTransport(new URL(server.url)),
          );
        } finally {
          await client.close();
        }
      } finally {
        await server.stop();
      }
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  }, 30_000);
});
