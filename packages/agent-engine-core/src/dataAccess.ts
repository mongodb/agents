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

export interface DataAccessProjectConfig {
  /**
   * Omit to allow every cluster in the project. `[]` allows the project but
   * no clusters in it.
   */
  readonly clusterNames?: readonly string[];
}

/** Allowed Atlas projects, keyed by 24-hex project id. `{}` is unrestricted. */
export type DataAccessConfig = {
  readonly [projectId: string]: DataAccessProjectConfig;
};

export type ResolvedDataAccess = Readonly<
  Record<string, DataAccessProjectConfig>
>;

/**
 * Validates `dataAccess` from config. Returns `undefined` when it is omitted
 * or `{}`, meaning the agent is unrestricted.
 */
export function resolveDataAccess(
  input?: DataAccessConfig,
): ResolvedDataAccess | undefined {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return undefined;

  const resolved: Record<string, DataAccessProjectConfig> = {};
  for (const [rawProjectId, project] of entries) {
    const projectId = rawProjectId.trim();
    if (!PROJECT_ID.test(projectId)) {
      throw new Error(
        `projectId must be a 24-character hex string, received "${rawProjectId}"`,
      );
    }
    if (project.clusterNames === undefined) {
      resolved[projectId] = {};
      continue;
    }
    const clusterNames = project.clusterNames.map((raw) => {
      const name = raw.trim();
      if (!CLUSTER_NAME.test(name)) {
        throw new Error(
          `clusterName must be 1-64 letters, numbers, underscores, or hyphens, received "${raw}"`,
        );
      }
      return name;
    });
    resolved[projectId] = { clusterNames: [...new Set(clusterNames)] };
  }
  return resolved;
}

function describeProject(project: DataAccessProjectConfig): string {
  const names = project.clusterNames;
  if (names === undefined) return "all clusters";
  if (names.length === 0) return "no clusters allowed";
  return `${names.length === 1 ? "cluster" : "clusters"} ${names.join(", ")}`;
}

/**
 * Describes the allowed projects and clusters for a system prompt. Returns
 * `undefined` when `dataAccess` is unrestricted.
 */
export function describeDataAccess(
  dataAccess?: DataAccessConfig,
): string | undefined {
  const resolved = resolveDataAccess(dataAccess);
  if (!resolved) return undefined;
  const lines = Object.entries(resolved).map(
    ([projectId, project]) => `- Project ${projectId}: ${describeProject(project)}`,
  );
  return [
    "Access is limited to these Atlas projects and clusters. Do not use any other project or cluster:",
    ...lines,
  ].join("\n");
}
