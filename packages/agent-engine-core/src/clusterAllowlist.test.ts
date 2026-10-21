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

import { ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import {
  clusterAllowlistMiddleware,
  guardClusterCall,
} from "./clusterAllowlist.js";
import { PARTIAL_LIST_NOTE } from "./clusterListFilter.js";
import { resolveDataAccess } from "./dataAccess.js";

const PROJECT = "64a1f3c2e8b94d0012c7a5e1";
const OPEN_PROJECT = "65c3d9e07f21ab4408d6e3f2";
const OTHER_PROJECT = "66e7b4a1c5d38f2290a1b7c4";

const resolved = resolveDataAccess({
  [PROJECT]: { clusterNames: ["example-test", "example-staging"] },
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
    const request = call("mongodb__remote_atlas_connect", {
      projectId: OTHER_PROJECT,
      clusterName: "example-prod",
    });
    const handler = vi.fn(async () => "ran");

    await expect(guardClusterCall(undefined, request, handler)).resolves.toBe(
      "ran",
    );
    expect(handler).toHaveBeenCalledWith(request);
  });

  it.each([
    ["an allowed cluster", "mongodb__remote_atlas_connect", { projectId: PROJECT, clusterName: "example-test" }],
    ["any cluster in an open project", "mongodb__atlas_inspect_cluster", { projectId: OPEN_PROJECT, clusterName: "anything" }],
    ["a project-level tool on an allowed project", "mongodb__atlas_list_clusters", { projectId: PROJECT }],
    ["an org-level tool", "mongodb__atlas_list_projects", {}],
    ["a database tool", "mongodb__find", { database: "db", collection: "c" }],
    ["stringified arguments", "mongodb__atlas_connect_cluster", JSON.stringify({ projectId: PROJECT, clusterName: "example-staging" })],
    ["a non-MongoDB tool", "search_knowledge", { query: "indexes" }],
  ])("runs %s", async (_label, name, args) => {
    expect((await run(call(name, args))).ran).toBe(true);
  });

  it.each([
    ["mongodb__atlas_list_clusters", {}, "needs a projectId"],
    ["mongodb__atlas_create_project", { projectName: "new" }, "needs a projectId"],
    ["mongodb__atlas_list_clusters", { projectId: OTHER_PROJECT }, `Project ${OTHER_PROJECT} is not in the dataAccess allowlist.`],
    ["mongodb__remote_atlas_connect", { projectId: PROJECT, clusterName: "example-prod" }, `Cluster example-prod in project ${PROJECT} is not in the dataAccess allowlist.`],
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
      call("mongodb__remote_atlas_connect", { projectId: PROJECT, clusterName: "example-test" }),
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

describe("guardClusterCall list results", () => {
  const tag = "untrusted-user-data-1";
  const listClusters = call("mongodb__atlas_list_clusters", { projectId: PROJECT });

  function toolMessage(content: unknown, status?: "error") {
    return new ToolMessage({
      content: content as string,
      name: "mongodb__atlas_list_clusters",
      tool_call_id: "call-1",
      artifact: { raw: "unfiltered" },
      ...(status ? { status } : {}),
    });
  }

  it("replaces the tool message with the filtered list", async () => {
    const original = toolMessage(
      `Found 2 clusters:<${tag}>${JSON.stringify({
        clusters: [{ name: "example-test" }, { name: "example-prod" }],
      })}</${tag}>`,
    );

    const result = (await guardClusterCall(
      resolved,
      listClusters,
      async () => original,
    )) as ToolMessage;

    expect(result).not.toBe(original);
    expect(result.content).toContain("Found 1 cluster:");
    expect(result.content).not.toContain("example-prod");
    expect(result.content).toContain(PARTIAL_LIST_NOTE);
    expect(result.tool_call_id).toBe("call-1");
    expect(result.artifact).toBeUndefined();
  });

  it("passes tool errors through", async () => {
    const error = toolMessage("Atlas API error", "error");
    await expect(
      guardClusterCall(resolved, listClusters, async () => error),
    ).resolves.toBe(error);
  });

  it.each([
    ["unreadable text", toolMessage("Clusters: example-prod")],
    ["content blocks", toolMessage([{ type: "text", text: "example-prod" }])],
    ["a non-message result", { update: { messages: [] } }],
  ])("withholds %s", async (_label, original) => {
    const result = await guardClusterCall(
      resolved,
      listClusters,
      async () => original,
    );
    expect(result).toMatchObject({
      status: "error",
      content: expect.stringContaining("was withheld"),
    });
    expect(JSON.stringify(result)).not.toContain("example-prod");
  });

  it("leaves other tool results alone", async () => {
    const users = new ToolMessage({
      content: "example-prod (CLUSTER)",
      tool_call_id: "call-1",
    });
    await expect(
      guardClusterCall(
        resolved,
        call("mongodb__atlas_list_db_users", { projectId: PROJECT }),
        async () => users,
      ),
    ).resolves.toBe(users);
  });
});

describe("clusterAllowlistMiddleware", () => {
  it("routes wrapped tool calls through the guard", async () => {
    const middleware = clusterAllowlistMiddleware({
      [PROJECT]: { clusterNames: ["example-test"] },
    });
    const handler = vi.fn(async () => "ran");

    const result = await middleware.wrapToolCall?.(
      call("mongodb__atlas_list_clusters") as never,
      handler as never,
    );

    expect(middleware.name).toBe("clusterAllowlist");
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error" });
  });
});
