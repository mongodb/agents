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
 * Strings the system prompt may use when the user does not name a project,
 * cluster, database, or collection. `""` or `undefined` leaves that field
 * unset. The strings are not checked.
 */
export interface DefaultDataConfig {
  readonly projectId?: string;
  readonly clusterName?: string;
  readonly databaseName?: string;
  readonly collectionName?: string;
}

function filled(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

/**
 * Describes the default strings for a system prompt. Returns `undefined`
 * when every field is `""` or `undefined`. Tool arguments are `projectId`,
 * `clusterName`, `database`, and `collection`.
 */
export function describeDefaultData(
  defaultData?: DefaultDataConfig,
): string | undefined {
  if (!defaultData) return undefined;

  const projectId = filled(defaultData.projectId);
  const clusterName = filled(defaultData.clusterName);
  const databaseName = filled(defaultData.databaseName);
  const collectionName = filled(defaultData.collectionName);

  const lines: string[] = [];
  if (projectId) lines.push(`- projectId: ${projectId}`);
  if (clusterName) lines.push(`- clusterName: ${clusterName}`);
  if (databaseName) lines.push(`- database: ${databaseName}`);
  if (collectionName) lines.push(`- collection: ${collectionName}`);
  if (lines.length === 0) return undefined;

  return [
    "Use these defaults when the user does not name values for them.",
    "Defaults are not permissions. The allowed projects, clusters, and databases still apply.",
    "",
    ...lines,
  ].join("\n");
}
