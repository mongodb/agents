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

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { AtlasFixtureSchema } from "../atlas/fixtures.js";
import { AgentEvalCaseSchema } from "../schemas.js";
import {
  QUERY_INSIGHTS_CLUSTER,
  QUERY_INSIGHTS_PROJECT_ID,
  portQueryInsightsCase,
  renderQueryInsightsSeed,
} from "./portQueryInsightsCase.js";

// Made-up fixtures in the source shape. No source data is copied here.
function source(overrides: {
  stats?: Record<string, unknown>;
  binMetadata?: Record<string, unknown>;
  paSuggestion?: unknown;
} = {}) {
  return {
    referenceAnswer: {
      queryOverview: "This query finds loans by `memberId`.",
      areasWorthInvestigating: [
        {
          leadSentence: "The Performance Advisor recommends an index on `memberId`.",
          elaboration: "The query scans the whole collection.",
          isPerformanceAdvisorSuggestion: true,
        },
      ],
    },
    stats: {
      queryShape: '{"filter": {"memberId": {"$eq": "?string"}}, "sort": {"dueAt": -1}, "limit": 10}',
      namespace: "library.loans",
      command: "find",
      execCount: 20.0,
      keysExamined: 0.0,
      docsExamined: 400000.0,
      docsReturned: 200.0,
      avgWorkingMillis: 151.4,
      totalWorkingMillis: 3028.0,
      totalTimeToResponseMicros: 3100000.0,
      ...overrides.stats,
    },
    binMetadata: {
      usesIndex: false,
      hasSortStage: true,
      numYields: null,
      ...overrides.binMetadata,
    },
    paSuggestion:
      "paSuggestion" in overrides
        ? overrides.paSuggestion
        : { namespace: "library.loans", indexSpec: '{"memberId": 1, "dueAt": -1}' },
  };
}

function attrOf(line: Record<string, unknown>) {
  return line.attr as Record<string, unknown>;
}

function slowLogLines(seed: ReturnType<typeof portQueryInsightsCase>["seed"]) {
  const cluster = AtlasFixtureSchema.parse(seed).projects[0].clusters[0];
  return cluster.advisor.slowQueries.map((entry) => ({
    namespace: entry.namespace,
    line: JSON.parse(entry.line as string) as Record<string, unknown>,
  }));
}

describe("portQueryInsightsCase", () => {
  it("puts per-execution values and the suggested index in the seed", () => {
    const { seedName, seed } = portQueryInsightsCase(source(), { id: "07" });

    expect(seedName).toBe("query-insights-case-07");
    const parsed = AtlasFixtureSchema.parse(seed);
    expect(parsed.projects[0].id).toBe(QUERY_INSIGHTS_PROJECT_ID);
    const cluster = parsed.projects[0].clusters[0];
    expect(cluster.name).toBe(QUERY_INSIGHTS_CLUSTER);
    expect(cluster.advisor.suggestedIndexes).toEqual([
      {
        id: "idx1",
        namespace: "library.loans",
        index: [{ memberId: 1 }, { dueAt: -1 }],
        weight: 1,
        impact: ["query-shape-1"],
      },
    ]);

    const lines = slowLogLines(seed);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      namespace: "library.loans",
      line: {
        t: { $date: "2026-11-04T12:00:00.000+00:00" },
        s: "I",
        c: "COMMAND",
        id: 51803,
        ctx: "conn1204",
        msg: "Slow query",
        attr: {
          type: "command",
          isFromUserConnection: true,
          ns: "library.loans",
          collectionType: "normal",
          command: {
            find: "loans",
            filter: { memberId: { $eq: "?string" } },
            sort: { dueAt: -1 },
            limit: 10,
            $db: "library",
          },
          planSummary: "COLLSCAN",
          keysExamined: 0,
          docsExamined: 20000,
          hasSortStage: true,
          nreturned: 10,
          protocol: "op_msg",
          workingMillis: 151,
          durationMillis: 155,
        },
      },
    });
    expect(lines.map((l) => l.line.t)).toEqual([
      { $date: "2026-11-04T12:00:00.000+00:00" },
      { $date: "2026-11-04T12:07:00.000+00:00" },
      { $date: "2026-11-04T12:14:00.000+00:00" },
    ]);
  });

  it("writes a small case that names the seed", () => {
    const { case: ported } = portQueryInsightsCase(source(), { id: "07" });

    const parsed = AgentEvalCaseSchema.parse(ported);
    expect(parsed.input.custom).toEqual({
      defaultData: {
        projectId: QUERY_INSIGHTS_PROJECT_ID,
        clusterName: QUERY_INSIGHTS_CLUSTER,
      },
      toolSetup: { mockAtlas: "query-insights-case-07" },
    });
    expect(parsed.input.messages).toEqual([
      { role: "user", content: "Why are my queries slow on Cluster0?" },
    ]);
    expect(ported.tags).toEqual(["find", "advisor-index", "sort"]);
    expect(ported.expected.outputMessages[1]).toEqual({
      role: "assistant-tool",
      toolCalls: [
        {
          name: "mongodb__atlas_get_performance_advisor",
          arguments: [
            { name: "projectId", type: "string", value: QUERY_INSIGHTS_PROJECT_ID },
            { name: "clusterName", type: "string", value: QUERY_INSIGHTS_CLUSTER },
          ],
        },
      ],
    });
    expect(ported.expected.custom.queryInsights).toEqual({
      suggestedIndexes: [
        { namespace: "library.loans", index: [{ memberId: 1 }, { dueAt: -1 }] },
      ],
      reference: [
        "Query overview: This query finds loans by `memberId`.",
        "",
        "Areas worth investigating:",
        "1. The Performance Advisor recommends an index on `memberId`. The query scans the whole collection.",
      ].join("\n"),
    });
  });

  it("leaves the suggested indexes empty when the advisor has none", () => {
    const { seed, case: ported } = portQueryInsightsCase(
      source({ paSuggestion: null, binMetadata: { usesIndex: true, hasSortStage: false } }),
      { id: "09" },
    );

    expect(AtlasFixtureSchema.parse(seed).projects[0].clusters[0].advisor.suggestedIndexes).toEqual([]);
    expect(ported.expected.custom.queryInsights.suggestedIndexes).toEqual([]);
    expect(ported.tags).toEqual(["find", "no-advisor-index"]);
    const { line } = slowLogLines(seed)[0];
    expect(attrOf(line).planSummary).toBe("IXSCAN");
    expect(attrOf(line)).not.toHaveProperty("hasSortStage");
  });

  it("builds aggregate and distinct commands, keeping the placeholders", () => {
    const aggregate = portQueryInsightsCase(
      source({
        stats: {
          command: "aggregate",
          queryShape:
            '{"pipeline": [{"$match": {"tags": {"$in": "?array<?string>"}, "open": {"$eq": "?bool"}}}, {"$lookup": {"from": "members", "localField": "memberId", "foreignField": "_id", "as": "member"}}]}',
        },
      }),
      { id: "11" },
    );
    expect(attrOf(slowLogLines(aggregate.seed)[0].line).command).toEqual({
      aggregate: "loans",
      pipeline: [
        { $match: { tags: { $in: "?array<?string>" }, open: { $eq: "?bool" } } },
        {
          $lookup: { from: "members", localField: "memberId", foreignField: "_id", as: "member" },
        },
      ],
      $db: "library",
    });

    const distinct = portQueryInsightsCase(
      source({
        stats: {
          command: "distinct",
          queryShape: '{"key": "branchId", "query": {"copies": {"$gt": "?number"}}}',
        },
      }),
      { id: "12" },
    );
    expect(attrOf(slowLogLines(distinct.seed)[0].line).command).toEqual({
      distinct: "loans",
      key: "branchId",
      query: { copies: { $gt: "?number" } },
      $db: "library",
    });
  });

  it("writes one line per execution, up to three", () => {
    const once = portQueryInsightsCase(source({ stats: { execCount: 1 } }), { id: "a" });
    expect(slowLogLines(once.seed)).toHaveLength(1);
    expect(attrOf(slowLogLines(once.seed)[0].line).docsExamined).toBe(400000);
  });

  it("takes overrides for the namespace, plan summary and message", () => {
    const ported = portQueryInsightsCase(source({ stats: { namespace: null } }), {
      id: "01",
      namespace: "shop.visits",
      planSummary: "IXSCAN { memberId: 1 }",
      message: "Which query should I fix first?",
    });

    const [{ namespace, line }] = slowLogLines(ported.seed);
    expect(namespace).toBe("shop.visits");
    expect(attrOf(line).command).toMatchObject({ find: "visits", $db: "shop" });
    expect(attrOf(line).planSummary).toBe("IXSCAN { memberId: 1 }");
    expect(ported.case.input.messages[0].content).toBe("Which query should I fix first?");
  });

  it("throws on what it cannot convert", () => {
    expect(() =>
      portQueryInsightsCase(source({ stats: { namespace: null } }), { id: "01" }),
    ).toThrow("case 01: the source has no namespace, so pass one");
    expect(() =>
      portQueryInsightsCase(source({ stats: { namespace: "nodot" } }), { id: "01" }),
    ).toThrow('namespace "nodot" is not <database>.<collection>');
    expect(() => portQueryInsightsCase({ stats: {} }, { id: "01" })).toThrow();
  });
});

describe("renderQueryInsightsSeed", () => {
  it("renders a fixture the mock Atlas schema accepts, with a header", () => {
    const { seed } = portQueryInsightsCase(source(), { id: "07" });
    const yaml = renderQueryInsightsSeed(seed, "Converted from case_07.json.");

    expect(yaml.startsWith("# Converted from case_07.json.\n")).toBe(true);
    expect(parse(yaml)).toEqual(seed);
    expect(() => AtlasFixtureSchema.parse(parse(yaml))).not.toThrow();
  });
});
