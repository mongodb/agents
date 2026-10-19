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

import { describe, expect, it, vi } from "vitest";

import {
  clusterAllowlistMiddleware,
  guardClusterCall,
} from "./clusterAllowlist.js";
import { resolveDataAccess } from "./dataAccess.js";

const PROJECT = "648c61425116351907dba2db";
const OPEN_PROJECT = "6a982c0522ab3c3c953c5ead";
const OTHER_PROJECT = "6091982e8e21a2564147eb86";

const resolved = resolveDataAccess({
  [PROJECT]: { clusterNames: ["docs-chatbot-test", "docs-chatbot-staging"] },
  [OPEN_PROJECT]: {},
});

function call(name: string, args: unknown = {}) {
  return { toolCall: { id: "call-1", name, args } };
}

async function run(
  request: ReturnType<typeof call>,
  dataAccess = resolved,
) {
  const handler = vi.fn(async () => "ran");
  const result = await guardClusterCall(dataAccess, request, handler);
  return { result, ran: handler.mock.calls.length === 1 };
}

describe("guardClusterCall", () => {
  it("runs every call when dataAccess is unrestricted", async () => {
    const request = call("mongodb__connect", { connectionString: "mongodb://x" });
    const handler = vi.fn(async () => "ran");

    await expect(guardClusterCall(undefined, request, handler)).resolves.toBe(
      "ran",
    );
    expect(handler).toHaveBeenCalledWith(request);
  });

  it.each([
    ["an allowed cluster", "mongodb__remote_atlas_connect", { projectId: PROJECT, clusterName: "docs-chatbot-test" }],
    ["any cluster in an open project", "mongodb__atlas_inspect_cluster", { projectId: OPEN_PROJECT, clusterName: "anything" }],
    ["a project-level tool on an allowed project", "mongodb__atlas_list_clusters", { projectId: PROJECT }],
    ["an org-level tool", "mongodb__atlas_list_projects", {}],
    ["a database tool", "mongodb__find", { database: "db", collection: "c" }],
    ["stringified arguments", "mongodb__atlas_connect_cluster", JSON.stringify({ projectId: PROJECT, clusterName: "docs-chatbot-staging" })],
    ["a non-MongoDB tool", "search_knowledge", { query: "indexes" }],
  ])("runs %s", async (_label, name, args) => {
    expect((await run(call(name, args))).ran).toBe(true);
  });

  it.each([
    ["mongodb__connect", { connectionString: "mongodb+srv://prod" }, "Use mongodb__remote_atlas_connect"],
    ["mongodb__switch_connection", {}, "Use mongodb__remote_atlas_connect"],
    ["mongodb__atlas_list_clusters", {}, "needs a projectId"],
    ["mongodb__atlas_create_project", { projectName: "new" }, "needs a projectId"],
    ["mongodb__atlas_list_clusters", { projectId: OTHER_PROJECT }, `Project ${OTHER_PROJECT} is not in the dataAccess allowlist.`],
    ["mongodb__remote_atlas_connect", { projectId: PROJECT, clusterName: "docs-chatbot-prod" }, `Cluster docs-chatbot-prod in project ${PROJECT} is not in the dataAccess allowlist.`],
    ["mongodb__atlas_get_performance_advisor", { projectId: PROJECT }, "needs a clusterName"],
  ])("rejects %s with %j", async (name, args, message) => {
    const { result, ran } = await run(call(name, args));
    expect(ran).toBe(false);
    expect(result).toMatchObject({
      type: "tool",
      status: "error",
      name,
      tool_call_id: "call-1",
      content: expect.stringContaining(message),
    });
  });

  it("rejects cluster and database tools when no project allows a cluster", async () => {
    const noClusters = resolveDataAccess({ [PROJECT]: { clusterNames: [] } });

    const connect = await run(
      call("mongodb__remote_atlas_connect", { projectId: PROJECT, clusterName: "docs-chatbot-test" }),
      noClusters,
    );
    expect(connect.ran).toBe(false);
    expect(connect.result).toMatchObject({
      content: `No clusters in project ${PROJECT} are allowed by dataAccess.`,
    });

    const find = await run(call("mongodb__find", {}), noClusters);
    expect(find.ran).toBe(false);
    expect(find.result).toMatchObject({
      content: "No clusters are allowed by dataAccess, so mongodb__find is unavailable.",
    });
  });
});

describe("clusterAllowlistMiddleware", () => {
  it("routes wrapped tool calls through the guard", async () => {
    const middleware = clusterAllowlistMiddleware({
      [PROJECT]: { clusterNames: ["docs-chatbot-test"] },
    });
    const handler = vi.fn(async () => "ran");

    const result = await middleware.wrapToolCall?.(
      call("mongodb__connect") as never,
      handler as never,
    );

    expect(middleware.name).toBe("clusterAllowlist");
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error" });
  });
});
