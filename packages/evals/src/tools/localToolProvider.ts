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
import { startMcpServer, type McpServerProcess } from "../mcp/startMcpServer.js";
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
 *   A case that allows writes gets its own mongod.
 *
 * Tools carry the names the agent sees in production (`mongodb__find`).
 * Every MongoDB tool needs `connectionId: "preconfigured"`.
 */
export function createLocalToolProvider(
  options: LocalToolProviderOptions = {},
): ToolProvider {
  let atlas: MockAtlasApi | undefined;
  const sharedMongos = new Map<string, Promise<EphemeralMongo>>();

  function sharedMongo(seed: MongoSeed): Promise<EphemeralMongo> {
    const key = JSON.stringify(seed);
    let started = sharedMongos.get(key);
    if (!started) {
      started = startEphemeralMongo(seed);
      sharedMongos.set(key, started);
    }
    return started;
  }

  return {
    async start() {
      atlas = await startMockAtlasApi();
    },

    async stop() {
      const mongos = await Promise.allSettled([...sharedMongos.values()]);
      sharedMongos.clear();
      await Promise.all(
        mongos.map((m) => (m.status === "fulfilled" ? m.value.stop() : undefined)),
      );
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
          mongo = await startEphemeralMongo(setup.localMongo);
          cleanups.push(() => mongo?.stop());
        } else if (setup.localMongo) {
          mongo = await sharedMongo(setup.localMongo);
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
