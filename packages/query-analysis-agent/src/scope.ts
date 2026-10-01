import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { formatToolErrorForAgent } from "@repo/agent-engine-core";

const PROJECT_ID = /^[a-f0-9]{24}$/i;
const CLUSTER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface QueryAnalysisScope {
  projectId?: string;
  clusterName?: string;
}

export interface ScopeInput {
  projectId?: string;
  clusterName?: string;
}

interface ToolCallRequest {
  toolCall?: {
    id?: string;
    name: string;
    args?: Record<string, unknown>;
  };
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Accepts the optional project and cluster pin from config.
 * Blank fields are unset. A present field must be a 24-hex project id
 * or an Atlas cluster name.
 */
export function resolveScope(input: ScopeInput = {}): QueryAnalysisScope | undefined {
  const projectId = blankToUndefined(input.projectId);
  const clusterName = blankToUndefined(input.clusterName);

  if (projectId && !PROJECT_ID.test(projectId)) {
    throw new Error(
      `projectId must be a 24-character hex string, received "${projectId}"`,
    );
  }
  if (clusterName && !CLUSTER_NAME.test(clusterName)) {
    throw new Error(
      `clusterName must be 1-64 letters, numbers, underscores, or hyphens, received "${clusterName}"`,
    );
  }
  if (!projectId && !clusterName) return undefined;
  return {
    ...(projectId ? { projectId } : {}),
    ...(clusterName ? { clusterName } : {}),
  };
}

export function describeScope(scope: QueryAnalysisScope | undefined): string {
  if (!scope) {
    return "No project or cluster is pinned. Resolve the project and cluster before analyzing slow queries.";
  }
  if (scope.projectId && scope.clusterName) {
    return `Analysis is limited to cluster ${scope.clusterName} in project ${scope.projectId}.`;
  }
  if (scope.projectId) {
    return `Analysis is limited to project ${scope.projectId}.`;
  }
  return `Analysis is limited to cluster ${scope.clusterName}.`;
}

function readStringArg(
  args: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function scopeViolation(
  scope: QueryAnalysisScope,
  args: Record<string, unknown>,
): string | undefined {
  const projectId = readStringArg(args, ["projectId", "groupId"]);
  if (
    scope.projectId &&
    projectId &&
    projectId.toLowerCase() !== scope.projectId.toLowerCase()
  ) {
    return `project ${projectId}`;
  }

  const clusterName = readStringArg(args, ["clusterName"]);
  if (scope.clusterName && clusterName && clusterName !== scope.clusterName) {
    return `cluster ${clusterName}`;
  }
  return undefined;
}

/**
 * Stops a tool call whose arguments name a different project or cluster
 * than the one this agent is pinned to. Tools that do not carry those
 * arguments are left alone. An unpinned agent does not check.
 */
export async function enforceScope<T>(
  scope: QueryAnalysisScope | undefined,
  request: ToolCallRequest,
  handler: () => T | Promise<T>,
): Promise<T | ToolMessage> {
  if (!scope) return handler();

  const toolCall = request.toolCall;
  const violation = scopeViolation(scope, toolCall?.args ?? {});
  if (!violation) return handler();
  if (!toolCall?.id) {
    throw new Error(
      `Tool "${toolCall?.name ?? "unknown"}" targeted ${violation}, outside this agent's scope. ${describeScope(scope)}`,
    );
  }

  return new ToolMessage({
    content: formatToolErrorForAgent(
      toolCall.name,
      new Error(
        `Arguments target ${violation}, outside this agent's scope. ${describeScope(scope)} Retry with the pinned project and cluster.`,
      ),
    ),
    tool_call_id: toolCall.id,
    name: toolCall.name,
    status: "error",
  });
}

export function scopeGuardMiddleware(scope: QueryAnalysisScope | undefined) {
  return createMiddleware({
    name: "scopeGuard",
    wrapToolCall: async (request, handler) =>
      enforceScope(scope, request, () => handler(request)),
  });
}
