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

/**
 * Tools `mongodb-mcp-server` registers that the Atlas Managed MCP service
 * the agents use in production does not. They need a local machine (saved
 * connections, log files, Atlas Local containers, exports) or duplicate the
 * knowledge tools the agents register themselves.
 *
 * Left enabled, write-mode cases would offer them to the agent. The list is
 * kept honest by `managedTools.contract.test.ts`, which fails when the
 * installed server renames one or adds a tool nobody has classified.
 *
 * This is a denylist of server tool names (hyphenated), not of the
 * `mongodb__` names the agent sees. It is not verified against the managed
 * service's own tool list.
 */
export const LOCAL_ONLY_MCP_TOOLS: readonly string[] = [
  "atlas-local-connect-deployment",
  "atlas-local-create-deployment",
  "atlas-local-delete-deployment",
  "atlas-local-list-deployments",
  "connect",
  "disconnect",
  "export",
  "list-connections",
  "list-knowledge-sources",
  "mongodb-logs",
  "search-knowledge",
];

/**
 * Every server tool the harness offers, by server name. Cases are checked
 * against it, so a typo in a tool name fails when the dataset loads. The
 * contract test keeps it equal to what the installed server lists.
 */
export const MANAGED_MCP_TOOLS: readonly string[] = [
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
];

/** The name the agent sees, `a-b` to `mongodb__a_b`. */
export function agentToolName(serverToolName: string): string {
  return `mongodb__${serverToolName.replaceAll("-", "_")}`;
}

/** The server's tool name for an agent-visible one, `mongodb__a_b` to `a-b`. */
export function serverToolName(agentToolName: string): string | undefined {
  const prefix = "mongodb__";
  return agentToolName.startsWith(prefix)
    ? agentToolName.slice(prefix.length).replaceAll("_", "-")
    : undefined;
}

export function isManagedMcpTool(serverToolName: string): boolean {
  return !LOCAL_ONLY_MCP_TOOLS.includes(serverToolName);
}

/**
 * `--disabledTools` also matches operation types and categories, and the
 * server's `connect` operation type covers `atlas-connect-cluster`, which
 * the agents use. So `connect` the tool cannot be disabled by name. Filter
 * discovered tools with `isManagedMcpTool` as well.
 */
const AMBIGUOUS_WITH_OPERATION_TYPES: readonly string[] = ["connect"];

/** Environment for a child server that hides the local-only tools it can. */
export function disabledToolsEnv(): Record<string, string> {
  return {
    MDB_MCP_DISABLED_TOOLS: LOCAL_ONLY_MCP_TOOLS.filter(
      (name) => !AMBIGUOUS_WITH_OPERATION_TYPES.includes(name),
    ).join(","),
  };
}
