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
