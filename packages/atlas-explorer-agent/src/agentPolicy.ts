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

import {
  LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
  SEARCH_KNOWLEDGE_TOOL_NAME,
  selectTools,
  writeOperationsAllowed,
} from "@repo/agent-engine-core";

export { writeOperationsAllowed };

/**
 * Agent Engine sanitizes MCP hyphens to underscores and prefixes the server name.
 *
 * This explicit allowlist is a shipping bridge until Agent Engine preserves MCP
 * tool annotations on `app.getTools()`.
 *
 * Names follow Atlas Managed MCP `read`, `metadata`, and `connect` tools,
 * plus the shared knowledge tools from `@repo/agent-engine-core`
 * (`search_knowledge`, `list_knowledge_sources`). Local-only tools such as
 * `mongodb-logs` and
 * `switch-connection` are omitted. `aggregate` and `aggregate-db` stay here
 * because MongoDB labels them read-only. A pipeline that contains `$out` or
 * `$merge` is a write and is suspended by `approveAggregateWritesMiddleware`
 * before it reaches Atlas.
 */
export const READ_ONLY_MCP_TOOLS: ReadonlySet<string> = new Set([
  LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
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
  "mongodb__connect",
  "mongodb__count",
  "mongodb__db_stats",
  "mongodb__explain",
  "mongodb__find",
  "mongodb__list_collections",
  "mongodb__list_databases",
  "mongodb__remote_atlas_connect",
  SEARCH_KNOWLEDGE_TOOL_NAME,
]);

/**
 * Always excluded. There is no way to opt into these tools.
 */
export const HIGH_RISK_MCP_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__atlas_create_access_list",
  "mongodb__atlas_create_db_user",
]);

export function selectAtlasTools<T extends { name: string }>(
  tools: readonly T[],
  allowWriteOperations: boolean = writeOperationsAllowed(),
): T[] {
  return selectTools(tools, READ_ONLY_MCP_TOOLS, allowWriteOperations).filter(
    (tool) => !HIGH_RISK_MCP_TOOLS.has(tool.name),
  );
}

export function mutativeInterruptOn<T extends { name: string }>(
  tools: readonly T[],
): Record<string, true> {
  const interruptOn: Record<string, true> = {};
  for (const tool of tools) {
    if (READ_ONLY_MCP_TOOLS.has(tool.name)) continue;
    interruptOn[tool.name] = true;
  }
  return interruptOn;
}
