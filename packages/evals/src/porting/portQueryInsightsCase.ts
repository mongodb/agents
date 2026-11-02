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
const SCRIPTED_REPLY = "Scripted reply for offline runs. A real model writes the report.";

/** Every converted seed has one org, one project and one cluster. */
export const QUERY_INSIGHTS_ORG_ID = "5a0000000000000000000001";
export const QUERY_INSIGHTS_PROJECT_ID = "6a0000000000000000000001";
export const QUERY_INSIGHTS_CLUSTER = "Cluster0";

/**
 * Slow-log lines per shape. Enough to read as a sample, few enough that the
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

/** The source's `referenceAnswer`, without its extra fields. */
export interface ReferenceAnswer {
  queryOverview: string;
  areasWorthInvestigating: { leadSentence: string; elaboration: string }[];
}

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
  /** Replaces the source's reference answer, which quotes lifetime totals. */
  readonly reference?: ReferenceAnswer;
}

export interface QueryInsightsCombinedPortOptions {
  /** Short id for the seed and case names, such as `multi-01`. */
  readonly id: string;
  /** The expert reference for all the shapes together, in priority order. */
  readonly reference: ReferenceAnswer;
  /** Replaces the default user message. */
  readonly message?: string;
  /** How many shape sections the report should have. */
  readonly expectedShapes?: number;
}

export interface PortedQueryInsightsCase {
  name: string;
  tags: string[];
  input: {
    messages: { role: "user"; content: string }[];
    custom: {
      defaultData: { projectId: string; clusterName: string };
      toolSetup: { mockAtlas: string };
      script: (
        | { toolCalls: { name: string; args: Record<string, string> }[] }
        | { text: string }
      )[];
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

type SuggestedIndex = {
  namespace: string;
  index: Record<string, number | string>[];
};

type SlowQuery = { namespace: string; line: string };

/** One converted query shape: its slow-log lines, its suggestion and its tags. */
interface ConvertedShape {
  readonly slowQueries: SlowQuery[];
  readonly suggestedIndex?: SuggestedIndex;
  readonly tags: string[];
  readonly reference: ReferenceAnswer;
}

/** `{"a": 1, "b": -1}` as `[{ a: 1 }, { b: -1 }]`, the shape Atlas returns. */
function indexKeys(indexSpec: string): Record<string, number | string>[] {
  const spec = JSON.parse(indexSpec) as Record<string, number | string>;
  return Object.entries(spec).map(([field, direction]) => ({ [field]: direction }));
}

function renderReference(reference: ReferenceAnswer): string {
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

function convertShape(
  source: unknown,
  label: string,
  overrides: { namespace?: string; planSummary?: string },
  shapeIndex: number,
): ConvertedShape {
  const { stats, binMetadata, paSuggestion, referenceAnswer } =
    SourceQueryInsightsCaseSchema.parse(source);

  const namespace = overrides.namespace ?? stats.namespace;
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
    planSummary: overrides.planSummary ?? (binMetadata.usesIndex ? "IXSCAN" : "COLLSCAN"),
    keysExamined: perExecution(stats.keysExamined),
    docsExamined: perExecution(stats.docsExamined),
    nreturned: perExecution(stats.docsReturned),
    hasSortStage: binMetadata.hasSortStage,
    workingMillis: stats.avgWorkingMillis,
    durationMillis: stats.totalTimeToResponseMicros / stats.execCount / 1000,
  };
  const line = (i: number) => slowLogLine(slowLog, command, i);
  const lineCount = Math.min(MAX_SLOW_LOG_LINES, Math.max(1, Math.round(stats.execCount)));

  return {
    slowQueries: Array.from({ length: lineCount }, (_, i) => ({
      namespace,
      line: line(shapeIndex * MAX_SLOW_LOG_LINES + i),
    })),
    suggestedIndex: paSuggestion
      ? { namespace: paSuggestion.namespace, index: indexKeys(paSuggestion.indexSpec) }
      : undefined,
    tags: [
      stats.command,
      paSuggestion ? "advisor-index" : "no-advisor-index",
      ...(binMetadata.hasSortStage ? ["sort"] : []),
    ],
    reference: referenceAnswer,
  };
}

function portShapes(
  sources: readonly unknown[],
  options: QueryInsightsPortOptions & { expectedShapes?: number },
): PortedQueryInsightsFixture {
  const label = `case ${options.id}`;
  const single = sources.length === 1;
  if (!single && (options.namespace || options.planSummary)) {
    throw new Error(`${label}: namespace and planSummary apply to one source only`);
  }
  if (!single && !options.reference) {
    throw new Error(`${label}: several sources need a reference`);
  }

  const shapes = sources.map((source, index) =>
    convertShape(
      source,
      label,
      { namespace: options.namespace, planSummary: options.planSummary },
      index,
    ),
  );
  const suggestedIndexes = shapes.flatMap((shape) =>
    shape.suggestedIndex ? [shape.suggestedIndex] : [],
  );

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
              slowQueries: shapes.flatMap((shape) => shape.slowQueries),
            },
          },
        ],
      },
    ],
  };

  const tags = [...new Set(shapes.flatMap((shape) => shape.tags))];
  const reference = options.reference ?? shapes[0].reference;
  return {
    seedName,
    seed,
    case: {
      name: seedName,
      tags: single ? tags : ["multi-shape", ...tags],
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
          script: [
            {
              toolCalls: [
                {
                  name: PERFORMANCE_ADVISOR,
                  args: {
                    projectId: QUERY_INSIGHTS_PROJECT_ID,
                    clusterName: QUERY_INSIGHTS_CLUSTER,
                  },
                },
              ],
            },
            { text: SCRIPTED_REPLY },
          ],
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
            reference: renderReference(reference),
            ...(options.expectedShapes !== undefined && {
              expectedShapes: options.expectedShapes,
            }),
          },
        },
      },
    },
  };
}

/**
 * Turns one source eval case into a mock Atlas seed and an eval case for
 * Atlas Query Insights that names it.
 *
 * The seed holds the scenario. The source stats are lifetime totals: counters
 * summed over every execution of the query shape, such as 1,328,412
 * `docsExamined` over an `execCount` of 20. The agent never sees those sums.
 * It reads slow-log lines, one per execution, so each line carries the
 * per-execution value (`docsExamined / execCount`, here 66,421), with the times
 * varying around the average. The query shape's `?string`-style placeholders
 * become made-up literals, as in a live line. A Performance Advisor suggestion
 * becomes the cluster's one suggested index.
 *
 * The case stays small: the user message, the expected Performance Advisor
 * call, the suggested indexes the report scorers check, and the reference.
 * The source reference answer quotes those lifetime totals ("1.33 M documents
 * examined across 20 executions"), which the agent cannot reproduce from
 * slow-log lines. So the CLI requires a rewritten `reference` for every case,
 * without the totals. The script replays the Performance Advisor call for the
 * offline scripted run.
 *
 * It throws on anything it cannot convert faithfully.
 */
export function portQueryInsightsCase(
  source: unknown,
  options: QueryInsightsPortOptions,
): PortedQueryInsightsFixture {
  return portShapes([source], options);
}

/**
 * Puts several source eval cases on one cluster, so the report has
 * to cover several shapes. Each source keeps its own namespace and suggested
 * index. The reference is written for the set, so it must be given.
 */
export function portQueryInsightsCombined(
  sources: readonly unknown[],
  options: QueryInsightsCombinedPortOptions,
): PortedQueryInsightsFixture {
  if (sources.length < 2) {
    throw new Error(`case ${options.id}: a combined case needs two or more sources`);
  }
  return portShapes(sources, options);
}

/** Renders a converted seed as a mock Atlas fixture. */
export function renderQueryInsightsSeed(seed: AtlasFixtureInput): string {
  return stringify(new Document(seed), { lineWidth: 0 });
}
