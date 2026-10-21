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

/** Whether `dataAccess` is omitted or `{}`, so nothing is restricted. */
export function isUnrestricted(dataAccess?: DataAccessConfig): boolean {
  return Object.keys(dataAccess ?? {}).length === 0;
}

/** Throws when `dataAccess` has an id or name Atlas would not accept. */
export function validateDataAccess(dataAccess: DataAccessConfig = {}): void {
  for (const [projectId, project] of Object.entries(dataAccess)) {
    if (!PROJECT_ID.test(projectId)) {
      throw new Error(
        `projectId must be a 24-character hex string, received "${projectId}"`,
      );
    }
    for (const name of project.clusterNames ?? []) {
      if (!CLUSTER_NAME.test(name)) {
        throw new Error(
          `clusterName must be 1-64 letters, numbers, underscores, or hyphens, received "${name}"`,
        );
      }
    }
  }
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
  if (!dataAccess || isUnrestricted(dataAccess)) return undefined;
  const lines = Object.entries(dataAccess).map(
    ([projectId, project]) => `- Project ${projectId}: ${describeProject(project)}`,
  );
  const notes = [
    "Project lists in tool results can include projects not listed above. Using one returns an error.",
  ];
  if (Object.values(dataAccess).some((project) => project.clusterNames)) {
    notes.push(
      "Cluster lists in tool results can include clusters not listed above. Using one returns an error.",
    );
  }
  return [
    "Access is limited to these Atlas projects and clusters. Do not use any other project or cluster:",
    ...lines,
    "",
    ...notes,
  ].join("\n");
}
