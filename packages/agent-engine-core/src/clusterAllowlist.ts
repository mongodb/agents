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
import { createMiddleware } from "langchain";

import {
  resolveDataAccess,
  type DataAccessConfig,
  type DataAccessProjectConfig,
  type ResolvedDataAccess,
} from "./dataAccess.js";

export interface ClusterToolCall {
  id?: string;
  name: string;
  args?: unknown;
}

const RAW_CONNECTION_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__connect",
  "mongodb__switch_connection",
]);

const ORG_LEVEL_ATLAS_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__atlas_get_regions",
  "mongodb__atlas_list_orgs",
  "mongodb__atlas_list_projects",
]);

const CLUSTER_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__remote_atlas_connect",
  "mongodb__atlas_connect_cluster",
  "mongodb__atlas_inspect_cluster",
  "mongodb__atlas_get_performance_advisor",
]);

/**
 * Returns why a MongoDB MCP call falls outside `dataAccess`, or `undefined`
 * when it may run. Arguments are never rewritten.
 */
export function checkClusterToolCall(
  resolved: ResolvedDataAccess,
  toolCall: ClusterToolCall,
): string | undefined {
  const { name } = toolCall;
  if (RAW_CONNECTION_TOOLS.has(name)) {
    return `${name} is disabled because dataAccess limits this agent to specific Atlas clusters. Use mongodb__remote_atlas_connect with an allowed projectId and clusterName.`;
  }

  // Database tools run on the connection mongodb__remote_atlas_connect or
  // mongodb__atlas_connect_cluster opened, and those only open allowed
  // clusters.
  if (!name.startsWith("mongodb__atlas_") && !CLUSTER_TOOLS.has(name)) {
    const noClusters = Object.values(resolved).every(
      (project) => project.clusterNames?.length === 0,
    );
    return noClusters
      ? `No clusters are allowed by dataAccess, so ${name} is unavailable.`
      : undefined;
  }
  if (ORG_LEVEL_ATLAS_TOOLS.has(name)) return undefined;

  const args = toolArgs(toolCall.args);
  const projectId = stringArg(args.projectId);
  if (!projectId) {
    return `${name} needs a projectId from the dataAccess allowlist.`;
  }
  const project = Object.hasOwn(resolved, projectId)
    ? resolved[projectId]
    : undefined;
  if (!project) {
    return `Project ${projectId} is not in the dataAccess allowlist.`;
  }

  const clusterName = stringArg(args.clusterName);
  if (clusterName) return checkCluster(projectId, project, clusterName);
  if (CLUSTER_TOOLS.has(name)) {
    return `${name} needs a clusterName from the dataAccess allowlist.`;
  }
  return undefined;
}

function checkCluster(
  projectId: string,
  project: DataAccessProjectConfig,
  clusterName: string,
): string | undefined {
  const allowed = project.clusterNames;
  if (allowed === undefined || allowed.includes(clusterName)) return undefined;
  if (allowed.length === 0) {
    return `No clusters in project ${projectId} are allowed by dataAccess.`;
  }
  return `Cluster ${clusterName} in project ${projectId} is not in the dataAccess allowlist.`;
}

export async function guardClusterCall<
  TRequest extends { toolCall?: ClusterToolCall },
  TResult,
>(
  resolved: ResolvedDataAccess | undefined,
  request: TRequest,
  handler: (request: TRequest) => TResult | Promise<TResult>,
): Promise<TResult | ToolMessage> {
  const toolCall = request.toolCall;
  if (!resolved || !toolCall?.name.startsWith("mongodb__")) {
    return handler(request);
  }
  const reason = checkClusterToolCall(resolved, toolCall);
  if (reason) return rejectToolCall(toolCall, reason);
  return handler(request);
}

/**
 * Rejects MongoDB MCP calls outside `dataAccess`. With `{}` or no argument,
 * every call runs unchanged.
 */
export function clusterAllowlistMiddleware(dataAccess?: DataAccessConfig) {
  const resolved = resolveDataAccess(dataAccess);
  return createMiddleware({
    name: "clusterAllowlist",
    wrapToolCall: (request, handler) =>
      guardClusterCall(resolved, request, handler),
  });
}

export function rejectToolCall(
  toolCall: ClusterToolCall,
  reason: string,
): ToolMessage {
  if (!toolCall.id) {
    throw new Error(`Cannot reject "${toolCall.name}" without a tool call id.`);
  }
  return new ToolMessage({
    content: reason,
    name: toolCall.name,
    tool_call_id: toolCall.id,
    status: "error",
  });
}

export function toolArgs(args: unknown): Record<string, unknown> {
  let value = args;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

export function stringArg(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
