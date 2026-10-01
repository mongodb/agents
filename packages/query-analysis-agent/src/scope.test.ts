import { describe, expect, it } from "vitest";

import {
  describeScope,
  enforceScope,
  resolveScope,
  scopeGuardMiddleware,
} from "./scope.js";

const PROJECT = "507f1f77bcf86cd799439011";
const OTHER_PROJECT = "aaaaaaaaaaaaaaaaaaaaaaaa";

describe("resolveScope", () => {
  it("treats blank fields as unpinned", () => {
    expect(resolveScope()).toBeUndefined();
    expect(resolveScope({ projectId: "  ", clusterName: "" })).toBeUndefined();
  });

  it("keeps a valid project, cluster, or both", () => {
    expect(resolveScope({ projectId: ` ${PROJECT} ` })).toEqual({
      projectId: PROJECT,
    });
    expect(resolveScope({ clusterName: "Cluster-1" })).toEqual({
      clusterName: "Cluster-1",
    });
    expect(
      resolveScope({ projectId: PROJECT, clusterName: "analytics_0" }),
    ).toEqual({
      projectId: PROJECT,
      clusterName: "analytics_0",
    });
  });

  it("rejects an id or name Atlas would not accept", () => {
    expect(() => resolveScope({ projectId: "cluster0" })).toThrow(/projectId/);
    expect(() => resolveScope({ clusterName: "-leading" })).toThrow(
      /clusterName/,
    );
  });
});

describe("describeScope", () => {
  it("describes each pin the prompt can quote", () => {
    expect(describeScope(undefined)).toMatch(/No project or cluster is pinned/);
    expect(describeScope({ projectId: PROJECT })).toBe(
      `Analysis is limited to project ${PROJECT}.`,
    );
    expect(describeScope({ clusterName: "Cluster-1" })).toBe(
      "Analysis is limited to cluster Cluster-1.",
    );
    expect(
      describeScope({ projectId: PROJECT, clusterName: "Cluster-1" }),
    ).toBe(`Analysis is limited to cluster Cluster-1 in project ${PROJECT}.`);
  });
});

describe("enforceScope", () => {
  const scope = { projectId: PROJECT, clusterName: "Cluster-1" };

  it("runs the tool when nothing is pinned", async () => {
    const result = await enforceScope(undefined, {
      toolCall: {
        id: "call-1",
        name: "mongodb__atlas_get_performance_advisor",
        args: { projectId: OTHER_PROJECT, clusterName: "other" },
      },
    }, async () => "ok");

    expect(result).toBe("ok");
  });

  it("runs tools that do not name a project or cluster", async () => {
    const result = await enforceScope(scope, {
      toolCall: {
        id: "call-2",
        name: "mongodb__find",
        args: { database: "highImpact", collection: "dbA" },
      },
    }, async () => "ok");

    expect(result).toBe("ok");
  });

  it("runs a call that stays inside the pin", async () => {
    const result = await enforceScope(scope, {
      toolCall: {
        id: "call-3",
        name: "mongodb__atlas_inspect_cluster",
        args: { projectId: PROJECT.toUpperCase(), clusterName: "Cluster-1" },
      },
    }, async () => "ok");

    expect(result).toBe("ok");
  });

  it("returns a recoverable tool error for another project or cluster", async () => {
    const result = await enforceScope(scope, {
      toolCall: {
        id: "call-4",
        name: "mongodb__atlas_get_performance_advisor",
        args: { groupId: OTHER_PROJECT, clusterName: "other" },
      },
    }, async () => {
      throw new Error("handler should not run");
    });

    expect(result).toMatchObject({
      tool_call_id: "call-4",
      name: "mongodb__atlas_get_performance_advisor",
      status: "error",
    });
    expect(result).toHaveProperty("content");
    const content = (result as { content: string }).content;
    expect(content).toContain("correct the tool arguments, and retry");
    expect(content).toContain(OTHER_PROJECT);
    expect(content).toContain("Cluster-1");
  });

  it("rejects a mismatched cluster even when the project matches", async () => {
    const result = await enforceScope(scope, {
      toolCall: {
        id: "call-5",
        name: "mongodb__atlas_list_alerts",
        args: { projectId: PROJECT, clusterName: "other" },
      },
    }, async () => "ok");

    expect((result as { content: string }).content).toContain("cluster other");
  });
});

describe("scopeGuardMiddleware", () => {
  it("names the middleware the app wires in", () => {
    expect(scopeGuardMiddleware(undefined).name).toBe("scopeGuard");
  });
});
