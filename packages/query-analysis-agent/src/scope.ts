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
