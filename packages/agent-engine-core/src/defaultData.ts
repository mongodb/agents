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
 * cluster, database, or collection. An empty string leaves that field unset.
 * The strings are not checked.
 */
export interface DefaultDataConfig {
  readonly projectId: string;
  readonly clusterName: string;
  readonly databaseName: string;
  readonly collectionName: string;
}

function filled(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Describes the default strings for a system prompt. Returns `undefined`
 * when every string is empty. Tool arguments are `projectId`, `clusterName`,
 * `database`, and `collection`.
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

  const notes = [
    "When the user does not name a value listed below, pass that string as the tool argument and continue.",
    "Do not call mongodb__atlas_list_projects, mongodb__atlas_list_clusters, mongodb__list_databases, or mongodb__list_collections to discover a value that is already set, and do not ask which one to use.",
    "For a project, cluster, database, or collection that is not listed below, list it, then ask only when more than one match remains.",
    "If the user names a different project, cluster, database, or collection, use what they named.",
    "These strings are not checked. When dataAccess is set, it still rejects a project or cluster outside its list. When databaseNames is set, it still rejects a database outside its list.",
  ];

  if (databaseName && collectionName) {
    notes.push(
      `When calling mongodb__atlas_get_performance_advisor, pass namespaces: ["${databaseName}.${collectionName}"].`,
    );
  } else if (databaseName) {
    notes.push(
      "A database without a collection is not a namespaces filter. Keep slow query logs whose namespace starts with that database.",
    );
  }

  return [...notes, "", ...lines].join("\n");
}
