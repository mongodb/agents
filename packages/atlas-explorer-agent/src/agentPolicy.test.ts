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

import { describe, expect, it } from "vitest";

import {
  HIGH_RISK_MCP_TOOLS,
  READ_ONLY_MCP_TOOLS,
  mutativeInterruptOn,
  selectAtlasTools,
  writeOperationsAllowed,
} from "./agentPolicy.js";

const discoveredCatalog = [
  { name: "mongodb__find" },
  { name: "mongodb__aggregate" },
  { name: "mongodb__aggregate_db" },
  { name: "mongodb__drop_collection" },
  { name: "mongodb__insert_many" },
  { name: "mongodb__atlas_create_cluster" },
  { name: "mongodb__atlas_create_access_list" },
  { name: "mongodb__atlas_create_db_user" },
  { name: "mongodb__future_mutating_operation" },
  { name: "mongodb__atlas_local_connect_deployment" },
  { name: "custom_unclassified_tool" },
] as const;

describe("writeOperationsAllowed", () => {
  it("treats unset, empty, and false values as disabled", () => {
    expect(writeOperationsAllowed({})).toBe(false);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "" })).toBe(false);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "   " })).toBe(
      false,
    );
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "false" })).toBe(
      false,
    );
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: " FALSE " })).toBe(
      false,
    );
  });

  it("treats other non-empty values as enabled", () => {
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "1" })).toBe(true);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "true" })).toBe(
      true,
    );
  });
});

describe("Atlas tool policy", () => {
  it("allowlists current Managed MCP read, metadata, and connect tools", () => {
    expect([...READ_ONLY_MCP_TOOLS].sort()).toEqual([
      "list_knowledge_sources",
      "mongodb__aggregate",
      "mongodb__aggregate_db",
      "mongodb__atlas_connect_cluster",
      "mongodb__atlas_get_performance_advisor",
      "mongodb__atlas_get_regions",
      "mongodb__atlas_inspect_access_list",
      "mongodb__atlas_inspect_cluster",
      "mongodb__atlas_list_alerts",
      "mongodb__atlas_list_clusters",
      "mongodb__atlas_list_db_users",
      "mongodb__atlas_list_orgs",
      "mongodb__atlas_list_projects",
      "mongodb__atlas_streams_discover",
      "mongodb__collection_indexes",
      "mongodb__collection_schema",
      "mongodb__collection_storage_size",
      "mongodb__count",
      "mongodb__db_stats",
      "mongodb__explain",
      "mongodb__find",
      "mongodb__list_collections",
      "mongodb__list_databases",
      "mongodb__remote_atlas_connect",
      "search_knowledge",
    ]);
  });

  it("denies database-user creation and access-list changes", () => {
    expect([...HIGH_RISK_MCP_TOOLS].sort()).toEqual([
      "mongodb__atlas_create_access_list",
      "mongodb__atlas_create_db_user",
    ]);
    expect(
      [...HIGH_RISK_MCP_TOOLS].every((name) => !READ_ONLY_MCP_TOOLS.has(name)),
    ).toBe(true);
  });

  it("hides write and unknown tools when writes are disabled", () => {
    expect(selectAtlasTools(discoveredCatalog, false)).toEqual([
      { name: "mongodb__find" },
      { name: "mongodb__aggregate" },
      { name: "mongodb__aggregate_db" },
    ]);
  });

  it("exposes non-read MCP tools for HITL when writes are enabled", () => {
    const selected = selectAtlasTools(discoveredCatalog, true);

    expect(selected).toEqual([
      { name: "mongodb__find" },
      { name: "mongodb__aggregate" },
      { name: "mongodb__aggregate_db" },
      { name: "mongodb__drop_collection" },
      { name: "mongodb__insert_many" },
      { name: "mongodb__atlas_create_cluster" },
      { name: "mongodb__future_mutating_operation" },
      { name: "mongodb__atlas_local_connect_deployment" },
      { name: "custom_unclassified_tool" },
    ]);
    expect(mutativeInterruptOn(selected)).toEqual({
      mongodb__drop_collection: true,
      mongodb__insert_many: true,
      mongodb__atlas_create_cluster: true,
      mongodb__future_mutating_operation: true,
      mongodb__atlas_local_connect_deployment: true,
      custom_unclassified_tool: true,
    });
  });

  it("withholds high-risk tools in both modes", () => {
    for (const allowWrites of [false, true]) {
      const names = selectAtlasTools(discoveredCatalog, allowWrites).map(
        (tool) => tool.name,
      );
      expect(names).not.toContain("mongodb__atlas_create_db_user");
      expect(names).not.toContain("mongodb__atlas_create_access_list");
    }
  });
});
