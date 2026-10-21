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
  isUnrestricted,
  validateDataAccess,
  type DataAccessConfig,
  type DataAccessProjectConfig,
} from "./dataAccess.js";

export interface ClusterToolCall {
  id?: string;
  name: string;
  args?: unknown;
}

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
  "mongodb__atlas_create_free_cluster",
  "mongodb__atlas_create_cluster",
  "mongodb__atlas_pause_resume_cluster",
  "mongodb__atlas_upgrade_cluster",
]);

const MAX_ARGUMENT_DEPTH = 20;

class ArgumentsTooDeepError extends Error {
  constructor() {
    super(
      `Tool call arguments nest deeper than ${MAX_ARGUMENT_DEPTH} levels, so dataAccess cannot check them.`,
    );
  }
}

/**
 * Returns why a MongoDB MCP call falls outside `dataAccess`, or `undefined`
 * when it may run. Arguments are never rewritten.
 */
export function findDataAccessViolation({
  allowedDataAccess,
  toolCall,
}: {
  allowedDataAccess: DataAccessConfig;
  toolCall: ClusterToolCall;
}): string | undefined {
  const { name } = toolCall;
  // Database tools run on the connection mongodb__remote_atlas_connect or
  // mongodb__atlas_connect_cluster opened, and those only open allowed
  // clusters.
  if (!name.startsWith("mongodb__atlas_") && !CLUSTER_TOOLS.has(name)) {
    const noClusters = Object.values(allowedDataAccess).every(
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
  const project = Object.hasOwn(allowedDataAccess, projectId)
    ? allowedDataAccess[projectId]
    : undefined;
  if (!project) {
    return `Project ${projectId} is not in the dataAccess allowlist.`;
  }

  let clusterNames: string[];
  try {
    clusterNames = clusterNamesIn({ value: args });
  } catch (error) {
    if (error instanceof ArgumentsTooDeepError) return error.message;
    throw error;
  }
  // create_free_cluster names the new cluster in `name`, not `clusterName`.
  const newClusterName =
    name === "mongodb__atlas_create_free_cluster"
      ? stringArg(args.name)
      : undefined;
  if (newClusterName) clusterNames.push(newClusterName);
  for (const clusterName of clusterNames) {
    const violation = findClusterViolation({ projectId, project, clusterName });
    if (violation) return violation;
  }
  if (clusterNames.length === 0 && CLUSTER_TOOLS.has(name)) {
    return `${name} needs a clusterName from the dataAccess allowlist.`;
  }
  if (
    clusterNames.length === 0 &&
    name === "mongodb__atlas_streams_build" &&
    args.connectionType === "Cluster"
  ) {
    return `${name} needs connectionConfig.clusterName from the dataAccess allowlist.`;
  }
  return undefined;
}

// Some tools nest the cluster, e.g. `connectionConfig.clusterName`, so every
// `clusterName` key at any depth is checked.
function clusterNamesIn({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): string[] {
  if (!Array.isArray(value) && !isRecord(value)) return [];
  if (depth > MAX_ARGUMENT_DEPTH) throw new ArgumentsTooDeepError();
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      clusterNamesIn({ value: item, depth: depth + 1 }),
    );
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const nested = clusterNamesIn({ value: child, depth: depth + 1 });
    const name = key === "clusterName" ? stringArg(child) : undefined;
    return name ? [name, ...nested] : nested;
  });
}

function findClusterViolation({
  projectId,
  project,
  clusterName,
}: {
  projectId: string;
  project: DataAccessProjectConfig;
  clusterName: string;
}): string | undefined {
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
>({
  allowedDataAccess,
  request,
  handler,
}: {
  allowedDataAccess: DataAccessConfig;
  request: TRequest;
  handler: (request: TRequest) => TResult | Promise<TResult>;
}): Promise<TResult | ToolMessage> {
  const toolCall = request.toolCall;
  if (
    isUnrestricted(allowedDataAccess) ||
    !toolCall?.name.startsWith("mongodb__")
  ) {
    return handler(request);
  }
  const violation = findDataAccessViolation({ allowedDataAccess, toolCall });
  if (violation) return rejectToolCall({ toolCall, reason: violation });
  return handler(request);
}

/**
 * Rejects MongoDB MCP calls outside `dataAccess`. With `{}` or no argument,
 * every call runs unchanged.
 */
export function clusterAllowlistMiddleware(dataAccess: DataAccessConfig = {}) {
  validateDataAccess(dataAccess);
  return createMiddleware({
    name: "clusterAllowlist",
    wrapToolCall: (request, handler) =>
      guardClusterCall({ allowedDataAccess: dataAccess, request, handler }),
  });
}

export function rejectToolCall({
  toolCall,
  reason,
}: {
  toolCall: ClusterToolCall;
  reason: string;
}): ToolMessage {
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
  return typeof value === "string" ? value.trim() : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
