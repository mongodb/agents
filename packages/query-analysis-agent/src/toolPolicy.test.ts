import { describe, expect, it } from "vitest";

import {
  QUERY_ANALYSIS_MCP_TOOLS,
  selectQueryAnalysisTools,
} from "./toolPolicy.js";

describe("Query Analysis tool policy", () => {
  it("allowlists the read-only investigation tools", () => {
    expect([...QUERY_ANALYSIS_MCP_TOOLS].sort()).toEqual([
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
  });

  it("keeps aggregate and drops writes, users, access lists, and streams", () => {
    const previous = process.env.ALLOW_WRITE_OPERATIONS;
    process.env.ALLOW_WRITE_OPERATIONS = "true";

    const discovered = [
      { name: "mongodb__find" },
      { name: "mongodb__aggregate" },
      { name: "mongodb__insert_many" },
      { name: "mongodb__atlas_list_db_users" },
      { name: "mongodb__atlas_inspect_access_list" },
      { name: "mongodb__atlas_streams_discover" },
      { name: "mongodb__drop_collection" },
    ];

    expect(selectQueryAnalysisTools(discovered)).toEqual([
      { name: "mongodb__find" },
      { name: "mongodb__aggregate" },
    ]);

    if (previous === undefined) {
      delete process.env.ALLOW_WRITE_OPERATIONS;
    } else {
      process.env.ALLOW_WRITE_OPERATIONS = previous;
    }
  });
});
