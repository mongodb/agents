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
import type { DataAccessConfig } from "./dataAccess.js";

const PROJECT = "64a1f3c2e8b94d0012c7a5e1";
const OPEN_PROJECT = "65c3d9e07f21ab4408d6e3f2";
const OTHER_PROJECT = "66e7b4a1c5d38f2290a1b7c4";

const allowedDataAccess = {
  projects: {
    [PROJECT]: { clusterNames: ["example-test", "example-staging"] },
    [OPEN_PROJECT]: {},
  },
} satisfies DataAccessConfig;

function call(name: string, args: unknown = {}) {
  return { toolCall: { id: "call-1", name, args } };
}

async function run(
  request: ReturnType<typeof call>,
  dataAccess: DataAccessConfig = allowedDataAccess,
) {
  const handler = vi.fn(async () => "ran");
  const result = await guardClusterCall({
    allowedDataAccess: dataAccess,
    request,
    handler,
  });
  return { result, ran: handler.mock.calls.length === 1 };
}

describe("guardClusterCall", () => {
  it("runs every call when dataAccess is unrestricted", async () => {
    const request = call("mongodb__remote_atlas_connect", {
      projectId: OTHER_PROJECT,
      clusterName: "example-prod",
    });
    const handler = vi.fn(async () => "ran");

    await expect(guardClusterCall({ allowedDataAccess: {}, request, handler })).resolves.toBe(
      "ran",
    );
    expect(handler).toHaveBeenCalledWith(request);
  });

  it("does not restrict clusters when only databaseNames is set", async () => {
    const request = call("mongodb__remote_atlas_connect", {
      projectId: OTHER_PROJECT,
      clusterName: "example-prod",
    });
    const dataAccess = { databaseNames: ["orders"] } satisfies DataAccessConfig;

    expect((await run(request, dataAccess)).ran).toBe(true);
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

  it("checks every nested clusterName against the call's project", async () => {
    const nested = (clusterName: string) =>
      call("mongodb__atlas_streams_build", {
        projectId: PROJECT,
        resource: "connection",
        connectionType: "Cluster",
        connectionConfig: { clusterName },
      });

    expect((await run(nested("example-test"))).ran).toBe(true);
    expect((await run(nested("example-prod"))).result).toMatchObject({
      content: `Cluster example-prod in project ${PROJECT} is not in the dataAccess allowlist.`,
    });

    const mixed = await run(
      call("mongodb__atlas_upgrade_cluster", {
        projectId: PROJECT,
        clusterName: "example-test",
        options: [{ clusterName: "example-prod" }],
      }),
    );
    expect(mixed.ran).toBe(false);
  });

  it("rejects arguments nested deeper than 20 levels", async () => {
    const nestedArgs = (levels: number) => {
      let value: unknown = { clusterName: "example-test" };
      for (let i = 1; i < levels; i++) value = { nested: value };
      return { projectId: PROJECT, nested: value };
    };

    expect((await run(call("mongodb__atlas_inspect_cluster", nestedArgs(20)))).ran).toBe(true);

    const tooDeep = await run(call("mongodb__atlas_inspect_cluster", nestedArgs(21)));
    expect(tooDeep.ran).toBe(false);
    expect(tooDeep.result).toMatchObject({
      content: expect.stringContaining("deeper than 20 levels"),
    });
  });

  it("does not let a cluster allowed in one project through in another", async () => {
    const perProject = {
      projects: {
        [PROJECT]: { clusterNames: ["example-test"] },
        [OTHER_PROJECT]: { clusterNames: ["example-prod"] },
      },
    } satisfies DataAccessConfig;

    const { ran, result } = await run(
      call("mongodb__remote_atlas_connect", { projectId: PROJECT, clusterName: "example-prod" }),
      perProject,
    );
    expect(ran).toBe(false);
    expect(result).toMatchObject({
      content: `Cluster example-prod in project ${PROJECT} is not in the dataAccess allowlist.`,
    });
  });

  it("allows a project with no clusters next to one that has clusters", async () => {
    const mixed = {
      projects: {
        [PROJECT]: { clusterNames: [] },
        [OPEN_PROJECT]: {},
      },
    } satisfies DataAccessConfig;

    const connect = await run(
      call("mongodb__remote_atlas_connect", { projectId: PROJECT, clusterName: "example-test" }),
      mixed,
    );
    expect(connect.ran).toBe(false);
    expect(connect.result).toMatchObject({
      content: `No clusters in project ${PROJECT} are allowed by dataAccess.`,
    });

    expect((await run(call("mongodb__atlas_list_clusters", { projectId: PROJECT }), mixed)).ran).toBe(true);
    expect((await run(call("mongodb__find", {}), mixed)).ran).toBe(true);
  });

  describe("write-mode cluster arguments", () => {
    const streamsConnection = (clusterName?: string) => ({
      projectId: PROJECT,
      resource: "connection",
      workspaceName: "ws",
      connectionName: "conn",
      connectionType: "Cluster",
      connectionConfig: clusterName ? { clusterName } : {},
    });
    const updateConnection = (connectionConfig: object) => ({
      projectId: PROJECT,
      workspaceName: "ws",
      action: "update-connection",
      resourceName: "conn",
      connectionConfig,
    });

    it.each([
      ["mongodb__atlas_create_free_cluster", { projectId: PROJECT, name: "example-prod", region: "US_EAST_1" }, "Cluster example-prod"],
      ["mongodb__atlas_create_free_cluster", { projectId: PROJECT, region: "US_EAST_1" }, "needs a clusterName"],
      ["mongodb__atlas_pause_resume_cluster", { projectId: PROJECT, clusterName: "example-prod" }, "Cluster example-prod"],
      ["mongodb__atlas_upgrade_cluster", { projectId: PROJECT }, "needs a clusterName"],
      ["mongodb__atlas_streams_build", streamsConnection("example-prod"), "Cluster example-prod"],
      ["mongodb__atlas_streams_build", streamsConnection(), "needs connectionConfig.clusterName"],
      ["mongodb__atlas_streams_manage", updateConnection({ clusterName: "example-prod" }), "Cluster example-prod"],
    ])("rejects %s with %j", async (name, args, message) => {
      const { result, ran } = await run(call(name, args));
      expect(ran).toBe(false);
      expect(result).toMatchObject({
        status: "error",
        content: expect.stringContaining(message),
      });
    });

    it.each([
      ["mongodb__atlas_create_free_cluster", { projectId: PROJECT, name: "example-test", region: "US_EAST_1" }],
      ["mongodb__atlas_streams_build", streamsConnection("example-staging")],
      ["mongodb__atlas_streams_build", { projectId: PROJECT, resource: "workspace", workspaceName: "ws" }],
    ])("runs %s with %j", async (name, args) => {
      expect((await run(call(name, args))).ran).toBe(true);
    });

    // An existing connection's cluster is not in the arguments, so
    // dataAccess cannot check where it points.
    it("cannot check an update that does not name a cluster", async () => {
      const update = updateConnection({
        dbRoleToExecute: { role: "read", type: "BUILT_IN" },
      });
      expect((await run(call("mongodb__atlas_streams_manage", update))).ran).toBe(true);
    });
  });

  it("rejects cluster and database tools when no project allows a cluster", async () => {
    const noClusters = {
      projects: { [PROJECT]: { clusterNames: [] } },
    } satisfies DataAccessConfig;

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

describe("clusterAllowlistMiddleware", () => {
  it("routes wrapped tool calls through the guard", async () => {
    const middleware = clusterAllowlistMiddleware({
      projects: { [PROJECT]: { clusterNames: ["example-test"] } },
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
