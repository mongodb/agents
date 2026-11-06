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

import { Document, stringify } from "yaml";
import { z } from "zod";

import type { AtlasFixtureInput } from "../atlas/fixtures.js";
import type { CustomExpected } from "../schemas.js";
import { fillPlaceholders, slowLogLine, type SlowLogShape } from "./slowLog.js";

const PERFORMANCE_ADVISOR = "mongodb__atlas_get_performance_advisor";

/** Every converted seed has one org, one project and one cluster. */
export const QUERY_INSIGHTS_ORG_ID = "5a0000000000000000000001";
export const QUERY_INSIGHTS_PROJECT_ID = "6a0000000000000000000001";
export const QUERY_INSIGHTS_CLUSTER = "Cluster0";

/**
 * Slow-log lines per seed. Enough to read as a sample, few enough that the
 * tool output stays short. A shape that ran fewer times gets fewer lines.
 */
const MAX_SLOW_LOG_LINES = 3;

const ReferenceAreaSchema = z.looseObject({
  leadSentence: z.string(),
  elaboration: z.string(),
});

/**
 * One source eval case file.
 * `stats` are lifetime totals for one query shape.
 */
const SourceQueryInsightsCaseSchema = z.looseObject({
  referenceAnswer: z.looseObject({
    queryOverview: z.string(),
    areasWorthInvestigating: z.array(ReferenceAreaSchema),
  }),
  stats: z.looseObject({
    /** The shape as JSON text, with `?<type>` in place of each value. */
    queryShape: z.string(),
    namespace: z.string().nullable(),
    command: z.string(),
    execCount: z.number().positive(),
    docsExamined: z.number().nonnegative(),
    docsReturned: z.number().nonnegative(),
    keysExamined: z.number().nonnegative(),
    avgWorkingMillis: z.number().nonnegative(),
    totalTimeToResponseMicros: z.number().nonnegative(),
  }),
  binMetadata: z.looseObject({
    usesIndex: z.boolean(),
    hasSortStage: z.boolean(),
  }),
  paSuggestion: z
    .looseObject({
      namespace: z.string(),
      /** The index as JSON text, keys in index order. */
      indexSpec: z.string(),
    })
    .nullable()
    .optional(),
});

export interface QueryInsightsPortOptions {
  /** Short id for the seed and case names, such as `08`. */
  readonly id: string;
  /** Replaces the source namespace. Needed when the source has none. */
  readonly namespace?: string;
  /**
   * Replaces the derived `planSummary`. The source only says whether an index
   * was used, not which, so the default is a bare `IXSCAN` or `COLLSCAN`.
   */
  readonly planSummary?: string;
  /** Replaces the default user message. */
  readonly message?: string;
}

export interface PortedQueryInsightsCase {
  name: string;
  tags: string[];
  input: {
    messages: { role: "user"; content: string }[];
    custom: {
      defaultData: { projectId: string; clusterName: string };
      toolSetup: { mockAtlas: string };
    };
  };
  expected: {
    outputMessages: unknown[];
    custom: Required<Pick<CustomExpected, "queryInsights">>;
  };
}

export interface PortedQueryInsightsFixture {
  /** Name of the mock Atlas fixture the case reads. */
  readonly seedName: string;
  readonly seed: AtlasFixtureInput;
  readonly case: PortedQueryInsightsCase;
}

/** `{"a": 1, "b": -1}` as `[{ a: 1 }, { b: -1 }]`, the shape Atlas returns. */
function indexKeys(indexSpec: string): Record<string, number | string>[] {
  const spec = JSON.parse(indexSpec) as Record<string, number | string>;
  return Object.entries(spec).map(([field, direction]) => ({ [field]: direction }));
}

function renderReference(
  reference: z.infer<typeof SourceQueryInsightsCaseSchema>["referenceAnswer"],
): string {
  const areas = reference.areasWorthInvestigating.map(
    (area, i) => `${i + 1}. ${area.leadSentence} ${area.elaboration}`,
  );
  return [
    `Query overview: ${reference.queryOverview}`,
    "",
    "Areas worth investigating:",
    ...areas,
  ].join("\n");
}

/**
 * Turns one source eval case into a mock Atlas seed and an eval case for
 * Atlas Query Insights that names it.
 *
 * The seed holds the scenario. The source stats are lifetime totals, and the
 * agent reads single slow-log lines, so each line carries the per-execution
 * values (`docsExamined / execCount` and so on), with the times varying around
 * the average. The query shape's `?string`-style placeholders become made-up
 * literals, as in a live line. A Performance Advisor suggestion becomes the
 * cluster's one suggested index.
 *
 * The case stays small: the user message, the expected Performance Advisor
 * call, the suggested indexes the report scorers check, and the reference.
 * The reference is the source's as written. It quotes lifetime totals the
 * agent never sees, so it must be rewritten before a case is committed.
 *
 * It throws on anything it cannot convert faithfully.
 */
export function portQueryInsightsCase(
  source: unknown,
  options: QueryInsightsPortOptions,
): PortedQueryInsightsFixture {
  const label = `case ${options.id}`;
  const { stats, binMetadata, paSuggestion, referenceAnswer } =
    SourceQueryInsightsCaseSchema.parse(source);

  const namespace = options.namespace ?? stats.namespace;
  if (!namespace) {
    throw new Error(`${label}: the source has no namespace, so pass one`);
  }
  const dot = namespace.indexOf(".");
  if (dot <= 0 || dot === namespace.length - 1) {
    throw new Error(`${label}: namespace "${namespace}" is not <database>.<collection>`);
  }
  const database = namespace.slice(0, dot);
  const collection = namespace.slice(dot + 1);

  const shape = fillPlaceholders(JSON.parse(stats.queryShape)) as Record<string, unknown>;
  const command = { [stats.command]: collection, ...shape, $db: database };
  const perExecution = (total: number) => Math.round(total / stats.execCount);
  const slowLog: SlowLogShape = {
    namespace,
    queryShapeText: stats.queryShape,
    planSummary: options.planSummary ?? (binMetadata.usesIndex ? "IXSCAN" : "COLLSCAN"),
    keysExamined: perExecution(stats.keysExamined),
    docsExamined: perExecution(stats.docsExamined),
    nreturned: perExecution(stats.docsReturned),
    hasSortStage: binMetadata.hasSortStage,
    workingMillis: stats.avgWorkingMillis,
    durationMillis: stats.totalTimeToResponseMicros / stats.execCount / 1000,
  };
  const line = (i: number) => slowLogLine(slowLog, command, i);
  const lineCount = Math.min(MAX_SLOW_LOG_LINES, Math.max(1, Math.round(stats.execCount)));

  const suggestedIndexes = paSuggestion
    ? [{ namespace: paSuggestion.namespace, index: indexKeys(paSuggestion.indexSpec) }]
    : [];

  const seedName = `query-insights-case-${options.id}`;
  const seed: AtlasFixtureInput = {
    orgs: [{ id: QUERY_INSIGHTS_ORG_ID, name: "Acme" }],
    projects: [
      {
        id: QUERY_INSIGHTS_PROJECT_ID,
        name: "prod",
        orgId: QUERY_INSIGHTS_ORG_ID,
        clusters: [
          {
            name: QUERY_INSIGHTS_CLUSTER,
            advisor: {
              suggestedIndexes: suggestedIndexes.map((index, i) => ({
                id: `idx${i + 1}`,
                ...index,
                weight: 1,
                impact: [`query-shape-${i + 1}`],
              })),
              slowQueries: Array.from({ length: lineCount }, (_, i) => ({ namespace, line: line(i) })),
            },
          },
        ],
      },
    ],
  };

  const tags = [
    stats.command,
    suggestedIndexes.length ? "advisor-index" : "no-advisor-index",
    ...(binMetadata.hasSortStage ? ["sort"] : []),
  ];
  return {
    seedName,
    seed,
    case: {
      name: seedName,
      tags,
      input: {
        messages: [
          {
            role: "user",
            content:
              options.message ?? `Why are my queries slow on ${QUERY_INSIGHTS_CLUSTER}?`,
          },
        ],
        custom: {
          defaultData: {
            projectId: QUERY_INSIGHTS_PROJECT_ID,
            clusterName: QUERY_INSIGHTS_CLUSTER,
          },
          toolSetup: { mockAtlas: seedName },
        },
      },
      expected: {
        outputMessages: [
          { role: "user" },
          {
            role: "assistant-tool",
            toolCalls: [
              {
                name: PERFORMANCE_ADVISOR,
                arguments: [
                  { name: "projectId", type: "string", value: QUERY_INSIGHTS_PROJECT_ID },
                  { name: "clusterName", type: "string", value: QUERY_INSIGHTS_CLUSTER },
                ],
              },
            ],
          },
          { role: "tool" },
          { role: "assistant" },
        ],
        custom: {
          queryInsights: {
            suggestedIndexes,
            reference: renderReference(referenceAnswer),
          },
        },
      },
    },
  };
}

/** Renders a converted seed as a mock Atlas fixture, with `header` as its opening comment. */
export function renderQueryInsightsSeed(seed: AtlasFixtureInput, header: string): string {
  const doc = new Document(seed);
  doc.commentBefore = header
    .split("\n")
    .map((line) => ` ${line}`.trimEnd())
    .join("\n");
  return stringify(doc, { lineWidth: 0 });
}
