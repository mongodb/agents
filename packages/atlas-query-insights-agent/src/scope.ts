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

const PROJECT_ID = /^[a-f0-9]{24}$/i;
const CLUSTER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface AtlasQueryInsightsScope {
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
export function resolveScope(input: ScopeInput = {}): AtlasQueryInsightsScope | undefined {
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

export function describeScope(scope: AtlasQueryInsightsScope | undefined): string {
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
