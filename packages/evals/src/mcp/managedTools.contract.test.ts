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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ATLAS_QUERY_INSIGHTS_MCP_TOOLS } from "@repo/atlas-query-insights-agent";
import { READ_ONLY_MCP_TOOLS } from "@repo/atlas-explorer-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMockAtlasApi, type MockAtlasApi } from "../atlas/mockAtlasApi.js";
import {
  LOCAL_ONLY_MCP_TOOLS,
  disabledToolsEnv,
  isManagedMcpTool,
  serverToolName,
} from "./managedTools.js";
import { startMcpServer, type McpServerProcess } from "./startMcpServer.js";

/**
 * These run the real mongodb-mcp-server, so they fail when an upgrade
 * changes a tool name, an argument, or the Atlas calls the tools make.
 */

const ORG = "5".padEnd(24, "0");
const PROJECT = "6".padEnd(24, "0");

const seed = {
  orgs: [{ id: ORG, name: "Acme" }],
  projects: [
    {
      id: PROJECT,
      name: "prod",
      orgId: ORG,
      clusters: [
        {
          name: "c1",
          advisor: {
            suggestedIndexes: [
              {
                id: "idx1",
                namespace: "shop.orders",
                index: [{ customerId: 1 }],
                weight: 1234,
                impact: ["q1"],
              },
            ],
            slowQueries: [
              { namespace: "shop.orders", line: "COLLSCAN customerId" },
              { namespace: "shop.carts", line: "SORT cartTotal" },
            ],
          },
        },
      ],
      alerts: [{ id: "alert1", eventTypeName: "HOST_DOWN" }],
    },
  ],
};

/** Tools the agents allow that the local server has no equivalent for. */
const MANAGED_SERVICE_ONLY = ["remote-atlas-connect"];

let mock: MockAtlasApi;
let server: McpServerProcess;
let client: Client;
let serverTools: string[];

async function connect(url: string): Promise<Client> {
  const c = new Client({ name: "contract-test", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return c;
}

async function callText(c: Client, name: string, args: object): Promise<string> {
  const result = await c.callTool({ name, arguments: args as never });
  const text = (result.content as { text?: string }[])
    .map((part) => part.text ?? "")
    .join("\n");
  expect(result.isError ?? false, text).toBe(false);
  return text;
}

beforeAll(async () => {
  mock = await startMockAtlasApi();
  mock.register("contract", seed);
  server = await startMcpServer({
    env: { ...mock.serverEnv("contract"), ...disabledToolsEnv() },
  });
  client = await connect(server.url);
  serverTools = (await client.listTools()).tools.map((t) => t.name);
});

afterAll(async () => {
  await client?.close();
  await server?.stop();
  await mock?.close();
});

describe("managed tool filter", () => {
  it("only names tools the installed server has", async () => {
    const everyTool = await startMcpServer({
      env: mock.serverEnv("contract"),
    });
    try {
      const all = (await (await connect(everyTool.url)).listTools()).tools.map(
        (t) => t.name,
      );
      expect(all.filter((n) => LOCAL_ONLY_MCP_TOOLS.includes(n)).sort()).toEqual(
        [...LOCAL_ONLY_MCP_TOOLS].sort(),
      );
    } finally {
      await everyTool.stop();
    }
  });

  it("hides the local-only tools the server can disable by name", () => {
    const hidden = LOCAL_ONLY_MCP_TOOLS.filter((n) => n !== "connect");
    for (const name of hidden) expect(serverTools).not.toContain(name);
  });

  it("leaves atlas-connect-cluster, which shares the connect operation type", () => {
    expect(serverTools).toContain("atlas-connect-cluster");
    expect(serverTools).toContain("connect");
    expect(serverTools.filter(isManagedMcpTool)).not.toContain("connect");
  });

  it("keeps every tool the agents allow, bar the managed-only ones", () => {
    const allowed = new Set([
      ...READ_ONLY_MCP_TOOLS,
      ...ATLAS_QUERY_INSIGHTS_MCP_TOOLS,
    ]);
    const wanted = [...allowed]
      .map(serverToolName)
      .filter((n): n is string => n !== undefined)
      .filter((n) => !MANAGED_SERVICE_ONLY.includes(n));
    expect(serverTools.filter(isManagedMcpTool)).toEqual(
      expect.arrayContaining(wanted),
    );
  });

  it("matches the reviewed tool list", () => {
    // A new tool in a server upgrade lands here. Decide whether the managed
    // service has it, then add it to LOCAL_ONLY_MCP_TOOLS or to this list.
    expect(serverTools.filter(isManagedMcpTool).sort()).toMatchInlineSnapshot(`
      [
        "aggregate",
        "aggregate-db",
        "atlas-connect-cluster",
        "atlas-create-access-list",
        "atlas-create-cluster",
        "atlas-create-db-user",
        "atlas-create-free-cluster",
        "atlas-create-project",
        "atlas-get-performance-advisor",
        "atlas-get-regions",
        "atlas-inspect-access-list",
        "atlas-inspect-cluster",
        "atlas-list-alerts",
        "atlas-list-clusters",
        "atlas-list-db-users",
        "atlas-list-orgs",
        "atlas-list-projects",
        "atlas-load-sample-dataset",
        "atlas-pause-resume-cluster",
        "atlas-streams-build",
        "atlas-streams-discover",
        "atlas-streams-manage",
        "atlas-streams-teardown",
        "atlas-upgrade-cluster",
        "collection-indexes",
        "collection-schema",
        "collection-storage-size",
        "count",
        "create-collection",
        "create-index",
        "db-stats",
        "delete-many",
        "drop-collection",
        "drop-database",
        "drop-index",
        "explain",
        "find",
        "insert-many",
        "list-collections",
        "list-databases",
        "rename-collection",
        "update-many",
      ]
    `);
  });
});

describe("mock Atlas API against the real tools", () => {
  it("lists organizations, projects, and clusters", async () => {
    expect(await callText(client, "atlas-list-orgs", {})).toContain("Acme");
    expect(await callText(client, "atlas-list-projects", {})).toContain("prod");
    const clusters = await callText(client, "atlas-list-clusters", {
      projectId: PROJECT,
    });
    expect(clusters).toContain('"name":"c1"');
    expect(clusters).toContain('"instanceSize":"M10"');
  });

  it("inspects a cluster and reports a missing one as a tool error", async () => {
    expect(
      await callText(client, "atlas-inspect-cluster", {
        projectId: PROJECT,
        clusterName: "c1",
      }),
    ).toContain('"paused":false');

    const missing = await client.callTool({
      name: "atlas-inspect-cluster",
      arguments: { projectId: PROJECT, clusterName: "nope" },
    });
    expect(missing.isError).toBe(true);
  });

  it("returns performance advisor suggestions and slow queries", async () => {
    const text = await callText(client, "atlas-get-performance-advisor", {
      projectId: PROJECT,
      clusterName: "c1",
    });
    expect(text).toContain("## Suggested Indexes");
    expect(text).toContain("customerId");
    expect(text).toContain("COLLSCAN customerId");
    expect(text.match(/COLLSCAN customerId/g)).toHaveLength(1);
  });

  it("scopes slow queries to the requested namespaces", async () => {
    const scoped = await callText(client, "atlas-get-performance-advisor", {
      projectId: PROJECT,
      clusterName: "c1",
      operations: ["slowQueryLogs"],
      namespaces: ["shop.carts"],
    });

    expect(scoped).toContain("SORT cartTotal");
    expect(scoped).not.toContain("COLLSCAN customerId");
  });

  it("lists alerts", async () => {
    expect(
      await callText(client, "atlas-list-alerts", { projectId: PROJECT }),
    ).toContain("HOST_DOWN");
  });

  it("keeps two concurrent servers' accounts apart", async () => {
    const other = mock.register("contract-2", seed);
    const second = await startMcpServer({
      env: { ...mock.serverEnv("contract-2"), ...disabledToolsEnv() },
    });
    const secondClient = await connect(second.url);
    try {
      await callText(secondClient, "atlas-pause-resume-cluster", {
        projectId: PROJECT,
        clusterName: "c1",
        action: "PAUSE",
      });

      expect(other.state().projects[0].clusters[0].paused).toBe(true);
      expect(
        await callText(client, "atlas-inspect-cluster", {
          projectId: PROJECT,
          clusterName: "c1",
        }),
      ).toContain('"paused":false');
    } finally {
      await secondClient.close();
      await second.stop();
      other.release();
    }
  });

  it("pausing a cluster changes what inspect reports", async () => {
    const account = mock.register("contract-3", seed);
    const own = await startMcpServer({
      env: { ...mock.serverEnv("contract-3"), ...disabledToolsEnv() },
    });
    const ownClient = await connect(own.url);
    try {
      await callText(ownClient, "atlas-pause-resume-cluster", {
        projectId: PROJECT,
        clusterName: "c1",
        action: "PAUSE",
      });
      expect(
        await callText(ownClient, "atlas-inspect-cluster", {
          projectId: PROJECT,
          clusterName: "c1",
        }),
      ).toContain('"paused":true');
      expect(
        account.requests().some((r) => r.method === "PATCH" && r.status === 200),
      ).toBe(true);
    } finally {
      await ownClient.close();
      await own.stop();
      account.release();
    }
  });
});
