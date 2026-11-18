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

import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards that the harness cannot go back to picking a port and handing it to
 * the child. That check-then-use window is what the race needs, so this test
 * fails if `freePort()` or any other probe comes back.
 *
 * The child is faked and announces a port the harness did not choose, so the
 * URL can only be right if the port came from the child's own log line.
 */

/** Argument vectors every `spawn` call received, in order. */
const spawnedArgs: string[][] = [];
/** A stack per socket a port probe would have opened. */
const probeSockets: string[] = [];
/** The port the fake child claims to have bound. */
const announced = { port: 0 };

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      spawnedArgs.push(args[1] as string[]);
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.exitCode = null;
      child.signalCode = null;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      };
      // The address line arrives after `spawn` returns, as the real one does.
      setImmediate(() => {
        child.stderr.emit(
          "data",
          Buffer.from(
            `[INFO] 1006100 - mcpHttpServer: Http server started on address: http://127.0.0.1:${announced.port}\n`,
          ),
        );
      });
      return child as never;
    },
  };
});

/**
 * `freePort()` listened on a `net` server. Recording every one created
 * catches a probe even if it came back under another name.
 */
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  const createServer = ((...args: never[]) => {
    probeSockets.push(new Error("port probe").stack ?? "probe");
    return (actual.createServer as (...a: never[]) => unknown)(...args);
  }) as typeof actual.createServer;
  return { ...actual, createServer, default: { ...actual, createServer } };
});

const { startMcpServer } = await import("./startMcpServer.js");

/** The fake child never listens, so readiness cannot be a real request. */
const realFetch = globalThis.fetch;

beforeEach(() => {
  spawnedArgs.length = 0;
  probeSockets.length = 0;
  announced.port = 0;
  vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
});

afterEach(() => {
  vi.stubGlobal("fetch", realFetch);
});

describe("how startMcpServer picks the port", () => {
  it("asks the child for port 0, opens no probe socket, and reads the port back", async () => {
    // Deliberately not a port the harness could have probed for.
    announced.port = 61_234;

    const server = await startMcpServer();

    const args = spawnedArgs.flat();
    expect(args[args.indexOf("--httpPort") + 1]).toBe("0");
    // The address line only reaches the harness with stderr logging on.
    expect(args[args.indexOf("--loggers") + 1]).toBe("stderr");

    // No probe means no window between choosing a port and binding it.
    expect(probeSockets).toEqual([]);
    expect(new URL(server.url).port).toBe(String(announced.port));
  });
});
