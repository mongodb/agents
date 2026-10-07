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

import type { WorkspaceKey } from "./types.ts";

/**
 * Copied from packages/atlas-explorer-agent/src/agentPolicy.ts (READ_ONLY_MCP_TOOLS).
 * toolsets.test.ts fails if this drifts from the source.
 */
export const EXPLORER_READ_TOOLS: readonly string[] = [
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
  "mongodb__list_knowledge_sources",
  "mongodb__remote_atlas_connect",
  "mongodb__search_knowledge",
];

/**
 * Copied from packages/atlas-query-insights-agent/src/toolPolicy.ts
 * (ATLAS_QUERY_INSIGHTS_MCP_TOOLS). toolsets.test.ts fails if this drifts.
 */
export const QUERY_INSIGHTS_TOOLS: readonly string[] = [
  "mongodb__aggregate",
  "mongodb__atlas_connect_cluster",
  "mongodb__atlas_get_performance_advisor",
  "mongodb__atlas_inspect_cluster",
  "mongodb__atlas_list_alerts",
  "mongodb__atlas_list_clusters",
  "mongodb__atlas_list_orgs",
  "mongodb__atlas_list_projects",
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
  "mongodb__list_knowledge_sources",
  "mongodb__remote_atlas_connect",
  "mongodb__search_knowledge",
];

/**
 * Platform and deep-agent tools that don't change anything outside the agent's own state.
 * The deployed platform reports `invoke_llm` (the model call) and `filesystem_*` names;
 * the bare names are what deepagents uses locally. `filesystem_ls`/`filesystem_download`
 * are how the agent loads its skills.
 */
export const SAFE_BUILTIN_TOOLS: readonly string[] = [
  "invoke_llm",
  "filesystem_ls",
  "filesystem_download",
  "filesystem_read",
  "filesystem_read_file",
  "filesystem_glob",
  "filesystem_grep",
  "ls",
  "read_file",
  "glob",
  "grep",
  "write_todos",
  "task",
];

/** Tools that write files or run commands in the sandbox, under either naming scheme. */
export const SANDBOX_WRITE_TOOLS: readonly string[] = [
  "write_file",
  "edit_file",
  "execute",
  "filesystem_write_file",
  "filesystem_edit_file",
  "filesystem_upload",
  "filesystem_execute",
];

export function readToolsFor(workspace: WorkspaceKey): ReadonlySet<string> {
  const mcp = workspace === "queryInsights" ? QUERY_INSIGHTS_TOOLS : EXPLORER_READ_TOOLS;
  return new Set([...mcp, ...SAFE_BUILTIN_TOOLS]);
}

/** Glob match where `*` matches any run of characters. */
export function toolMatches(pattern: string, toolName: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(toolName);
}

/** Sandbox writes, plus any MCP tool not on the workspace read list (writes, or tools the agent should never have). */
export function isNonReadTool(workspace: WorkspaceKey, toolName: string): boolean {
  if (SANDBOX_WRITE_TOOLS.includes(toolName) || /(^|_)(write|edit|upload|execute|exec|shell)(_|$)/.test(toolName)) {
    return true;
  }
  return toolName.startsWith("mongodb__") && !readToolsFor(workspace).has(toolName);
}
