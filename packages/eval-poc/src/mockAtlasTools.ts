import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

/** Tool names match what Agent Engine hands the agent: `<server>__<tool>`. */
export interface MockAtlasState {
  projects: { id: string; name: string }[];
  clusters: Record<string, { name: string; tier: string; state: string }[]>;
  calls: { name: string; args: unknown }[];
}

export function makeMockAtlas(): {
  state: MockAtlasState;
  tools: StructuredToolInterface[];
} {
  const state: MockAtlasState = {
    projects: [{ id: "64b7f0000000000000000001", name: "prod" }],
    clusters: {
      "64b7f0000000000000000001": [
        { name: "Cluster0", tier: "M10", state: "IDLE" },
      ],
    },
    calls: [],
  };
  const log = (name: string, args: unknown) => state.calls.push({ name, args });

  const listProjects = tool(
    async (args) => {
      log("mongodb__atlas_list_projects", args);
      return JSON.stringify(state.projects);
    },
    {
      name: "mongodb__atlas_list_projects",
      description: "List Atlas projects",
      schema: z.object({}),
    },
  );
  const listClusters = tool(
    async (args) => {
      log("mongodb__atlas_list_clusters", args);
      return JSON.stringify(state.clusters[args.projectId] ?? []);
    },
    {
      name: "mongodb__atlas_list_clusters",
      description: "List clusters in an Atlas project",
      schema: z.object({ projectId: z.string() }),
    },
  );
  const upgradeCluster = tool(
    async (args) => {
      log("mongodb__atlas_upgrade_cluster", args);
      const c = state.clusters[args.projectId]?.find(
        (x) => x.name === args.clusterName,
      );
      if (c) c.tier = args.tier;
      return JSON.stringify(c ?? { error: "not found" });
    },
    {
      name: "mongodb__atlas_upgrade_cluster",
      description: "Scale a cluster to a new tier",
      schema: z.object({
        projectId: z.string(),
        clusterName: z.string(),
        tier: z.string(),
      }),
    },
  );
  return {
    state,
    tools: [listProjects, listClusters, upgradeCluster] as unknown as StructuredToolInterface[],
  };
}
