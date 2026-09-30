/**
 * Magenta sanitizes MCP hyphens to underscores and prefixes the server name.
 *
 * This explicit allowlist is a shipping bridge until Magenta preserves MCP
 * tool annotations on `app.getTools()`.
 *
 * Names follow Atlas Managed MCP `read`, `metadata`, and `connect` tools.
 * Local-only tools such as `export`, `mongodb-logs`, and `switch-connection`
 * are omitted. `aggregate` and `aggregate-db` stay here because MongoDB labels
 * them read-only; `$out`/`$merge` is blocked by a read-only Atlas credential.
 */
export const READ_ONLY_MCP_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__aggregate",
  "mongodb__aggregate_db",
  "mongodb__atlas_connect_cluster",
  "mongodb__atlas_get_performance_advisor",
  "mongodb__atlas_get_regions",
  "mongodb__atlas_inspect_access_list",
  "mongodb__atlas_inspect_cluster",
  "mongodb__atlas_list_alerts",
  "mongodb__atlas_list_clusters",
  "mongodb__atlas_list_db_users",
  "mongodb__atlas_list_orgs",
  "mongodb__atlas_list_projects",
  "mongodb__atlas_streams_discover",
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

export function writeOperationsAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.ALLOW_WRITE_OPERATIONS?.trim().toLowerCase();
  return Boolean(value) && value !== "false";
}

export function selectAtlasTools<T extends { name: string }>(
  tools: readonly T[],
  allowWriteOperations: boolean = writeOperationsAllowed(),
): T[] {
  return tools.filter(
    (tool) =>
      READ_ONLY_MCP_TOOLS.has(tool.name) || allowWriteOperations,
  );
}

export function mutativeInterruptOn<T extends { name: string }>(
  tools: readonly T[],
): Record<string, true> {
  const interruptOn: Record<string, true> = {};
  for (const tool of tools) {
    if (READ_ONLY_MCP_TOOLS.has(tool.name)) continue;
    interruptOn[tool.name] = true;
  }
  return interruptOn;
}
