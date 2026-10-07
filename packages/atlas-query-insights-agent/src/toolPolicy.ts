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

import { selectTools } from "@repo/agent-engine-core";

/**
 * Subset of Atlas MCP tools available to the Atlas Query Insights agent.
 *
 * Writes are never enabled. `aggregate` stays available as a read tool.
 * A pipeline that contains `$out` or `$merge` is rejected.
 */
export const ATLAS_QUERY_INSIGHTS_MCP_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__aggregate",
  "mongodb__atlas_connect_cluster",
  "mongodb__atlas_get_performance_advisor",
  "mongodb__atlas_inspect_cluster",
  "mongodb__atlas_list_alerts",
  "mongodb__atlas_list_clusters",
  "mongodb__atlas_list_orgs",
  "mongodb__atlas_list_projects",
  "mongodb__collection_indexes",
  "mongodb__collection_schema",
  "mongodb__collection_storage_size",
  "mongodb__connect",
  "mongodb__count",
  "mongodb__db_stats",
  "mongodb__explain",
  "mongodb__find",
  "mongodb__list_collections",
  "mongodb__list_databases",
  "mongodb__list_knowledge_sources",
  "mongodb__remote_atlas_connect",
  "mongodb__search_knowledge",
]);

export function selectAtlasQueryInsightsTools<T extends { name: string }>(
  tools: readonly T[],
): T[] {
  return selectTools(tools, ATLAS_QUERY_INSIGHTS_MCP_TOOLS, false);
}
