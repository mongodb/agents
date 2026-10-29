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

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerProcess } from "../mcp/startMcpServer.js";

/** Every `mongodb-mcp-server` this test's provider started. */
const spawned: McpServerProcess[] = [];

vi.mock("../mcp/startMcpServer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mcp/startMcpServer.js")>();
  return {
    ...actual,
    startMcpServer: async (...args: Parameters<typeof actual.startMcpServer>) => {
      const server = await actual.startMcpServer(...args);
      spawned.push(server);
      return server;
    },
  };
});

const { createLocalToolProvider } = await import("./localToolProvider.js");

let provider: ReturnType<typeof createLocalToolProvider>;

beforeAll(async () => {
  provider = createLocalToolProvider();
  await provider.start?.();
});

afterAll(async () => {
  await provider.stop?.();
});

beforeEach(() => {
  spawned.length = 0;
});

describe("servers started per case", () => {
  it("starts no server for a read-only case that calls no tool", async () => {
    const first = await provider.forCase({ allowWrites: false });
    await first.dispose();
    // One discovery server for the run, not one per case.
    expect(spawned).toHaveLength(1);

    spawned.length = 0;
    const second = await provider.forCase({ allowWrites: false });
    await second.dispose();
    expect(spawned).toHaveLength(0);
  });

  it("serves a read-only case's tool call from its own server", async () => {
    const caseTools = await provider.forCase({ allowWrites: false });
    spawned.length = 0;
    const find = caseTools.tools.find((t) => t.name === "mongodb__atlas_list_orgs");
    // The case's own server starts on the call, not on `forCase`.
    expect(spawned).toHaveLength(0);
    await expect(find!.invoke({} as never)).resolves.toBeDefined();
    expect(spawned).toHaveLength(1);
    await caseTools.dispose();
  });

  it("gives every write case its own server", async () => {
    const writeCase = await provider.forCase({ allowWrites: true });
    expect(spawned).toHaveLength(1);
    await writeCase.dispose();
  });
});
