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

import { randomUUID } from "node:crypto";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
  RuntimeMCPConfigSchema,
  discoverMcpTools,
  makeMcpToolCallable,
  type MCPToolBinding,
} from "@mongodb-js/agent-engine-runner-shared";

import { startMockAtlasApi, type MockAtlasApi } from "../atlas/mockAtlasApi.js";
import { disabledToolsEnv, isManagedMcpTool } from "../mcp/managedTools.js";
import {
  startMcpServer,
  type McpServerProcess,
} from "../mcp/startMcpServer.js";
import {
  startEphemeralMongo,
  type EphemeralMongo,
} from "../mongo/ephemeralMongo.js";
import type { MongoSeed } from "../mongo/seed.js";
import { knowledgeTools } from "./knowledgeTools.js";
import { LocalToolSetupSchema } from "./localToolSetup.js";
import type { CaseTools, CaseToolsRequest, ToolProvider } from "./types.js";

export interface LocalToolProviderOptions {
  /**
   * Also offer `search_knowledge` and `list_knowledge_sources`, as the
   * agents do. They call knowledge.mongodb.com, so they are off by default.
   */
  readonly includeKnowledgeTools?: boolean;
  readonly serverStartTimeoutMs?: number;
  /**
   * How many unused shared mongod instances to keep for reuse. A shared one
   * stops as soon as no case is using it and more than this many are idle,
   * oldest first. Defaults to 2.
   */
  readonly maxIdleSharedMongos?: number;
  /** Starts a mongod. Replaced in tests to count starts and stops. */
  readonly startMongo?: (seed: MongoSeed) => Promise<EphemeralMongo>;
}

interface SharedMongo {
  readonly started: Promise<EphemeralMongo>;
  users: number;
}

/** The server name the agents' `agent.yaml` uses, so tool names match. */
const SERVER_NAME = "mongodb";

function mcpConfig(url: string) {
  return RuntimeMCPConfigSchema.parse({
    servers: {
      [SERVER_NAME]: { url, auth: { type: "none" }, timeout_seconds: 30 },
    },
  });
}

function toLangChainTool(binding: MCPToolBinding): StructuredToolInterface {
  const call = makeMcpToolCallable(binding);
  return tool((args: Record<string, unknown>) => call(args), {
    name: binding.sdkToolName,
    description: binding.description.trim(),
    schema: binding.inputSchema as never,
  }) as unknown as StructuredToolInterface;
}

/**
 * Tools backed by real servers on this machine, so no credentials are needed.
 *
 * - Each case gets its own `mongodb-mcp-server` child process, the same
 *   server and transport the agents use in production.
 * - The server's Atlas API calls go to one shared mock, which keeps a
 *   separate account per case.
 * - A case with `toolSetup.localMongo` also gets a MongoDB connection. Read-only
 *   cases with identical seed data share one mongod and a read-only server.
 *   A shared mongod stops once no case uses it and more than
 *   `maxIdleSharedMongos` others are idle. A case that allows writes gets its
 *   own mongod.
 *
 * Tools carry the names the agent sees in production (`mongodb__find`).
 * Every MongoDB tool needs `connectionId: "preconfigured"`.
 */
export function createLocalToolProvider(
  options: LocalToolProviderOptions = {},
): ToolProvider {
  let atlas: MockAtlasApi | undefined;
  const startMongo = options.startMongo ?? startEphemeralMongo;
  const maxIdle = options.maxIdleSharedMongos ?? 2;
  const sharedMongos = new Map<string, SharedMongo>();
  /** Keys of shared instances nobody is using, oldest first. */
  const idleKeys = new Set<string>();

  async function stopShared(entry: SharedMongo): Promise<void> {
    const [result] = await Promise.allSettled([entry.started]);
    if (result.status === "fulfilled") await result.value.stop();
  }

  async function trimIdle(): Promise<void> {
    while (idleKeys.size > maxIdle) {
      const [oldest] = idleKeys;
      idleKeys.delete(oldest);
      const entry = sharedMongos.get(oldest);
      sharedMongos.delete(oldest);
      if (entry) await stopShared(entry);
    }
  }

  function acquireSharedMongo(seed: MongoSeed) {
    const key = JSON.stringify(seed);
    let entry = sharedMongos.get(key);
    if (!entry) {
      const created: SharedMongo = { started: startMongo(seed), users: 0 };
      // A failed start must not be handed to later cases.
      created.started.catch(() => {
        if (sharedMongos.get(key) === created) sharedMongos.delete(key);
        idleKeys.delete(key);
      });
      sharedMongos.set(key, created);
      entry = created;
    }
    const held = entry;
    held.users++;
    idleKeys.delete(key);
    let released = false;
    return {
      mongo: held.started,
      async release() {
        if (released) return;
        released = true;
        held.users--;
        if (held.users > 0 || sharedMongos.get(key) !== held) return;
        idleKeys.add(key);
        await trimIdle();
      },
    };
  }

  return {
    async start() {
      atlas = await startMockAtlasApi();
    },

    async stop() {
      const entries = [...sharedMongos.values()];
      sharedMongos.clear();
      idleKeys.clear();
      await Promise.all(entries.map(stopShared));
      await atlas?.close();
      atlas = undefined;
    },

    async forCase(request: CaseToolsRequest): Promise<CaseTools> {
      if (!atlas) {
        throw new Error("createLocalToolProvider: start() has not run");
      }
      const setup = LocalToolSetupSchema.parse(request.setup ?? {});
      const cleanups: (() => Promise<void> | void)[] = [];
      const cleanup = async () => {
        for (const fn of cleanups.reverse()) await fn();
      };

      try {
        const clientId = `case-${randomUUID()}`;
        const account = atlas.register(clientId, setup.mockAtlas ?? {});
        cleanups.push(() => account.release());

        let mongo: EphemeralMongo | undefined;
        if (setup.localMongo && request.allowWrites) {
          mongo = await startMongo(setup.localMongo);
          cleanups.push(() => mongo?.stop());
        } else if (setup.localMongo) {
          const shared = acquireSharedMongo(setup.localMongo);
          cleanups.push(() => shared.release());
          mongo = await shared.mongo;
        }

        const server: McpServerProcess = await startMcpServer({
          env: {
            ...atlas.serverEnv(clientId),
            ...disabledToolsEnv(),
            ...(mongo && { MDB_MCP_CONNECTION_STRING: mongo.uri }),
          },
          args: request.allowWrites ? [] : ["--readOnly"],
          startTimeoutMs: options.serverStartTimeoutMs,
        });
        cleanups.push(() => server.stop());

        const bindings = await discoverMcpTools(mcpConfig(server.url));
        const tools = bindings
          .filter((b) => isManagedMcpTool(b.toolName))
          .map(toLangChainTool);
        if (options.includeKnowledgeTools) tools.push(...knowledgeTools());

        return {
          tools,
          async state() {
            return {
              atlas: account.state(),
              atlasRequests: account.requests(),
              ...(mongo && { mongo: await mongo.dump() }),
            };
          },
          dispose: cleanup,
        };
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
  };
}
