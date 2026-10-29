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
  type RuntimeMCPServerConfig,
} from "@mongodb-js/agent-engine-runner-shared";
import { MongoClient } from "mongodb";

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
import type {
  CaseTools,
  CaseToolsRequest,
  MongoAccess,
  ToolProvider,
} from "./types.js";

export interface LocalToolProviderOptions {
  /**
   * Leave out `search_knowledge` and `list_knowledge_sources`, which the
   * agents have in production. They call the live knowledge.mongodb.com API,
   * so set this to keep a run offline. Default false.
   */
  readonly excludeKnowledgeTools?: boolean;
  readonly serverStartTimeoutMs?: number;
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

/**
 * The schema comes from `binding`; calls go to `serverConfig()`, which may
 * start the case's server first.
 */
function toLangChainTool(
  binding: MCPToolBinding,
  serverConfig: () => Promise<RuntimeMCPServerConfig>,
): StructuredToolInterface {
  return tool(
    async (args: Record<string, unknown>) =>
      makeMcpToolCallable({ ...binding, serverConfig: await serverConfig() })(
        args,
      ),
    {
      name: binding.sdkToolName,
      description: binding.description.trim(),
      schema: binding.inputSchema as never,
    },
  ) as unknown as StructuredToolInterface;
}

/**
 * Tools backed by real servers on this machine, so no credentials are needed.
 *
 * - One shared `mongodb-mcp-server`, the same server and transport the agents
 *   use in production, discovers the tool schemas once for the whole run.
 * - Each case that needs a server gets its own: a write case from the start, a
 *   read-only case on its first tool call. So a case that calls no tool, as
 *   every guardrail case does, starts no process.
 * - The server's Atlas API calls go to one shared mock, which keeps a
 *   separate account per case.
 * - A case with `toolSetup.localMongo` also gets a MongoDB connection. Read-only
 *   cases with identical seed data share one mongod. A case that allows writes
 *   gets its own mongod.
 *
 * Tools carry the names the agent sees in production (`mongodb__find`).
 * Every MongoDB tool needs `connectionId: "preconfigured"`.
 */
export function createLocalToolProvider(
  options: LocalToolProviderOptions = {},
): ToolProvider {
  let atlas: MockAtlasApi | undefined;
  let starting: Promise<MockAtlasApi> | undefined;
  // The CLI starts the provider once per task. Both tasks share it.
  let users = 0;
  // Limitation: shared read-only mongod instances stay running until `stop()`,
  // so sequential cases with the same seed reuse them without restarting. If a
  // suite ever defines many distinct read-only seeds, cap or evict entries here.
  const sharedMongos = new Map<string, Promise<EphemeralMongo>>();
  // Read-only cases have the same tools whatever their fixture holds: discovery
  // only lists schemas, it never opens a connection. So one read-only server
  // discovers them once for the whole run, and only its schema list is reused.
  // A case still gets its own server, and its own Atlas account, when it calls
  // a tool, so `atlasRequests` and `state()` stay per case.
  let readOnlySchemas: Promise<MCPToolBinding[]> | undefined;
  const readOnlyCleanups: (() => Promise<void> | void)[] = [];

  function sharedMongo(seed: MongoSeed): Promise<EphemeralMongo> {
    const key = JSON.stringify(seed);
    let started = sharedMongos.get(key);
    if (!started) {
      started = startEphemeralMongo(seed);
      sharedMongos.set(key, started);
    }
    return started;
  }

  function sharedReadOnlySchemas(): Promise<MCPToolBinding[]> {
    readOnlySchemas ??= (async () => {
      const clientId = "schema-discovery";
      const account = atlas!.register(clientId, {});
      readOnlyCleanups.push(() => account.release());
      const server = await startMcpServer({
        env: { ...atlas!.serverEnv(clientId), ...disabledToolsEnv() },
        args: ["--readOnly"],
        startTimeoutMs: options.serverStartTimeoutMs,
      });
      readOnlyCleanups.push(() => server.stop());
      return discoverMcpTools(mcpConfig(server.url));
    })().catch((error: unknown) => {
      // Let the next case try again rather than fail every case after this one.
      readOnlySchemas = undefined;
      throw error;
    });
    return readOnlySchemas;
  }

  /**
   * A case's read-only server, started by its first tool call. Most guardrail
   * cases make none, and a failed start must not outlive `forCase`.
   */
  function lazyReadOnlyServer(start: () => Promise<McpServerProcess>) {
    let started: Promise<McpServerProcess> | undefined;
    let disposed = false;
    return {
      async config(): Promise<RuntimeMCPServerConfig> {
        if (disposed) {
          throw new Error("case tools were disposed before the tool was called");
        }
        started ??= start();
        const { url } = await started;
        return mcpConfig(url).servers[SERVER_NAME]!;
      },
      async stop() {
        disposed = true;
        const server = await started?.catch(() => undefined);
        await server?.stop();
      },
    };
  }

  return {
    async start() {
      users++;
      starting ??= startMockAtlasApi();
      atlas = await starting;
    },

    async stop() {
      if (--users > 0) return;
      const mongos = [...sharedMongos.values()];
      sharedMongos.clear();
      // Discovery servers first: a later `start()` must not reuse them.
      const cleanups = [...readOnlyCleanups];
      readOnlyCleanups.length = 0;
      readOnlySchemas = undefined;
      for (const fn of cleanups.reverse()) await fn();
      await Promise.all(
        mongos.map(async (started) =>
          (await started.catch(() => undefined))?.stop(),
        ),
      );
      await atlas?.close();
      atlas = undefined;
      starting = undefined;
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
          mongo = await startEphemeralMongo(setup.localMongo);
          cleanups.push(() => mongo?.stop());
        } else if (setup.localMongo) {
          mongo = await sharedMongo(setup.localMongo);
        }

        const startCaseServer = () =>
          startMcpServer({
            env: {
              ...atlas!.serverEnv(clientId),
              ...disabledToolsEnv(),
              ...(mongo && { MDB_MCP_CONNECTION_STRING: mongo.uri }),
            },
            args: request.allowWrites ? [] : ["--readOnly"],
            startTimeoutMs: options.serverStartTimeoutMs,
          });

        let bindings: MCPToolBinding[];
        // Where a discovered tool sends its calls. Read-only tools resolve it
        // lazily, so a case that calls nothing starts no server.
        let caseServerConfig: () => Promise<RuntimeMCPServerConfig>;
        if (request.allowWrites) {
          // A write case changes its own mongod and Atlas account, so it keeps
          // its own server for the whole case.
          const server = await startCaseServer();
          cleanups.push(() => server.stop());
          const config = mcpConfig(server.url);
          bindings = await discoverMcpTools(config);
          caseServerConfig = async () => config.servers[SERVER_NAME]!;
        } else {
          // A read-only case changes nothing another case could see, so it
          // borrows the schemas discovered once for the run and starts its own
          // server only if the agent calls a tool.
          const lazy = lazyReadOnlyServer(startCaseServer);
          cleanups.push(() => lazy.stop());
          bindings = await sharedReadOnlySchemas();
          caseServerConfig = () => lazy.config();
        }

        const tools = bindings
          .filter((b) => isManagedMcpTool(b.toolName))
          .map((binding) => toLangChainTool(binding, caseServerConfig));
        if (!options.excludeKnowledgeTools) tools.push(...knowledgeTools());

        return {
          tools,
          async state() {
            return {
              atlas: account.state(),
              atlasRequests: account.requests(),
              ...(mongo && { mongo: await mongo.dump() }),
            };
          },
          ...(mongo && {
            withMongo: async <T>(fn: (access: MongoAccess) => Promise<T>) => {
              const client = new MongoClient(mongo.uri);
              try {
                return await fn({
                  client,
                  seed: setup.localMongo!,
                  baselineDbHashes: mongo.baselineDbHashes,
                });
              } finally {
                await client.close();
              }
            },
          }),
          dispose: cleanup,
        };
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
  };
}
