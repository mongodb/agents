import { selectTools } from "@repo/agent-engine-core";

/**
 * Subset of Atlas MCP tools available to the Atlas Query Insights agent.
 *
 * Writes are never enabled. `$out` and `$merge` are not filtered here;
 * the MCP credential is read-only, so Atlas rejects those stages.
 * `aggregate` stays available as a read tool.
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
