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

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The parent's environment without the server's own settings. A developer or
 * CI shell may export `MDB_MCP_CONNECTION_STRING` or Atlas credentials, and a
 * child that inherited them could reach a real deployment instead of the
 * case's fixture.
 */
export function inheritedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith("MDB_MCP_"),
    ),
  );
}

export interface McpServerProcess {
  /** Streamable HTTP endpoint, `http://127.0.0.1:<port>/mcp`. */
  readonly url: string;
  /** Everything the process wrote to stdout and stderr so far. */
  output(): string;
  stop(): Promise<void>;
}

export interface StartMcpServerOptions {
  /**
   * Added to the process environment. Inherited `MDB_MCP_*` variables are
   * dropped first, so only what is listed here configures the server.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Extra CLI flags, for example `["--readOnly"]`. */
  readonly args?: readonly string[];
  readonly startTimeoutMs?: number;
}

/**
 * SIGTERM, then SIGKILL after 3 s. Returns at once for a process that has
 * already exited, whether by code or by signal: no further `exit` event
 * would come, so waiting for one would hang.
 */
export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 3_000);
  await exited;
  clearTimeout(force);
}

function serverEntryPoint(): string {
  const lib = fileURLToPath(import.meta.resolve("mongodb-mcp-server"));
  return path.join(path.dirname(lib), "index.js");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function waitUntilListening(
  port: number,
  child: ChildProcess,
  timeoutMs: number,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `mongodb-mcp-server exited with ${child.exitCode ?? child.signalCode} before it was ready:\n${output()}`,
      );
    }
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(
    `mongodb-mcp-server did not listen within ${timeoutMs} ms:\n${output()}`,
  );
}

/**
 * Starts `mongodb-mcp-server` as a child process on a free local port, over
 * streamable HTTP like production. A process is cheap (about 0.7 s to
 * start, about 200 MB), and a separate one per case keeps each case's
 * Atlas credentials and MongoDB connection to itself.
 */
export async function startMcpServer({
  env = {},
  args = [],
  startTimeoutMs = 20_000,
}: StartMcpServerOptions = {}): Promise<McpServerProcess> {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      serverEntryPoint(),
      "--transport",
      "http",
      "--httpHost",
      "127.0.0.1",
      "--httpPort",
      String(port),
      ...args,
    ],
    {
      env: {
        ...inheritedEnv(),
        MDB_MCP_TELEMETRY: "disabled",
        ...env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, env.NODE_OPTIONS]
          .filter(Boolean)
          .join(" "),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let captured = "";
  const capture = (chunk: Buffer) => {
    captured += chunk.toString("utf8");
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const output = () => captured;

  try {
    await waitUntilListening(port, child, startTimeoutMs, output);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    output,
    stop: () => stopProcess(child),
  };
}
