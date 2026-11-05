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

/**
 * The line `mongodb-mcp-server` logs once its HTTP listener is bound. It is
 * the only place the child reports the port it actually got, which is why the
 * harness asks for port 0 and reads the port back from here instead of
 * picking one itself.
 */
const LISTENING_LINE =
  /Http server started on address: https?:\/\/127\.0\.0\.1:(\d+)/;

/** The port from {@link LISTENING_LINE}, or `undefined` before it appears. */
export function parseListeningPort(output: string): number | undefined {
  const match = LISTENING_LINE.exec(output);
  if (!match) return undefined;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : undefined;
}

function exitedError(child: ChildProcess, output: () => string): Error {
  return new Error(
    `mongodb-mcp-server exited with ${child.exitCode ?? child.signalCode} before it was ready:\n${output()}`,
  );
}

/**
 * Waits for the child to log its bound address, then for `/health` to answer.
 *
 * The address line arrives before the listener accepts connections, so the
 * poll stays: it is the readiness check. A child that exits first fails at
 * once. A child that never logs the line inside the timeout fails with the
 * whole captured output, because the wording of that line is a pinned
 * dependency's and an upgrade could change it.
 */
async function waitUntilListening(
  child: ChildProcess,
  timeoutMs: number,
  output: () => string,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw exitedError(child, output);
    }
    const port = parseListeningPort(output());
    if (port !== undefined) {
      await waitUntilHealthy(port, child, deadline, timeoutMs, output);
      return port;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `mongodb-mcp-server did not log "${LISTENING_LINE.source}" within ${timeoutMs} ms. ` +
          `It logs the bound address only with --loggers stderr, and the wording ` +
          `is mongodb-mcp-server's own; check it after an upgrade. Output so far:\n${output()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitUntilHealthy(
  port: number,
  child: ChildProcess,
  deadline: number,
  timeoutMs: number,
  output: () => string,
): Promise<void> {
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw exitedError(child, output);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(
    `mongodb-mcp-server bound port ${port} but did not answer /health within ${timeoutMs} ms:\n${output()}`,
  );
}

/**
 * Starts `mongodb-mcp-server` as a child process over streamable HTTP like
 * production. A process is cheap (about 0.7 s to start, about 200 MB), and a
 * separate one per case keeps each case's Atlas credentials and MongoDB
 * connection to itself.
 *
 * The child binds port 0, so the OS assigns the port inside its own
 * `listen()`. Nothing in this process can pick a port another process takes
 * in between, which a probe-then-spawn would allow.
 */
export async function startMcpServer({
  env = {},
  args = [],
  startTimeoutMs = 20_000,
}: StartMcpServerOptions = {}): Promise<McpServerProcess> {
  const child = spawn(
    process.execPath,
    [
      serverEntryPoint(),
      "--transport",
      "http",
      "--httpHost",
      "127.0.0.1",
      "--httpPort",
      "0",
      // Without this the server logs to disk and MCP only, and the bound
      // address never reaches the harness.
      "--loggers",
      "stderr",
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

  let port: number;
  try {
    port = await waitUntilListening(child, startTimeoutMs, output);
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
