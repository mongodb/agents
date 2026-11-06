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

import { createHash } from "node:crypto";

/**
 * Slow-query lines in the form the Atlas Performance Advisor returns them:
 * the raw `mongod` structured log line as a string, with the header fields
 * padded the way `mongod` pads them. The field set follows lines pulled from
 * a live Atlas cluster, cut to what the source stats can fill. Fields with no
 * source (`remote`, `reslen`, `cpuNanos`, `planningTimeMicros`, `queues`,
 * `numInterruptChecks`, `lsid`, `$clusterTime`) are left out.
 */

const START_MS = Date.parse("2026-11-04T12:00:00.000Z");
const GAP_MS = 7 * 60 * 1000;
const FIRST_CONNECTION = 1204;
const CONNECTIONS = 3;

/** The slowest and fastest executions sit this far from the average. */
const TIME_SPREAD = 0.12;

/** A live sample yielded about once per 8000 documents examined. */
const DOCS_PER_YIELD = 8000;

/** Atlas samples show `r` at the yield count plus 4. */
const BASE_LOCK_ACQUISITIONS = 4;

export interface SlowLogShape {
  readonly namespace: string;
  /** The source query shape text, `?<type>` in place of each value. */
  readonly queryShapeText: string;
  readonly planSummary: string;
  readonly keysExamined: number;
  readonly docsExamined: number;
  readonly nreturned: number;
  readonly hasSortStage: boolean;
  /** Averages per execution. Each line varies around them. */
  readonly workingMillis: number;
  readonly durationMillis: number;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** A number in [0, 1) that depends only on the text. */
function unit(text: string): number {
  return Number.parseInt(hash(text).slice(0, 8), 16) / 0x1_0000_0000;
}

const isoOffset = (ms: number) =>
  new Date(ms).toISOString().replace("Z", "+00:00");

/**
 * Replaces each `?<type>` placeholder with a literal, as a live line has. The
 * values are made up from the nearest field name, so the same shape always
 * gives the same command.
 */
export function fillPlaceholders(value: unknown, field = "value"): unknown {
  if (typeof value === "string") {
    switch (value) {
      case "?string":
        return field === "$language" ? "english" : `${field}-1042`;
      case "?number":
        return field === "skip" ? 20 : 10;
      case "?bool":
        return true;
      case "?array<?string>":
        return [`${field}-1042`, `${field}-2087`];
      default:
        return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => fillPlaceholders(item, field));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        fillPlaceholders(
          child,
          key.startsWith("$") && key !== "$language" ? field : key,
        ),
      ]),
    );
  }
  return value;
}

function attrFor(
  shape: SlowLogShape,
  command: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const spread =
    1 + TIME_SPREAD * (2 * unit(`${shape.queryShapeText}:${index}`) - 1);
  const numYields = Math.round((shape.docsExamined * spread) / DOCS_PER_YIELD);
  const shapeHash = hash(`${shape.namespace}:${shape.queryShapeText}`);
  const planHash = shapeHash.slice(0, 8).toUpperCase();
  const hasPlan = shape.planSummary !== "";

  return {
    type: "command",
    isFromUserConnection: true,
    ns: shape.namespace,
    collectionType: "normal",
    queryShapeHash: shapeHash.toUpperCase(),
    command,
    ...(hasPlan && { planSummary: shape.planSummary }),
    keysExamined: shape.keysExamined,
    docsExamined: shape.docsExamined,
    ...(shape.hasSortStage && { hasSortStage: true }),
    cursorExhausted: true,
    numYields,
    nreturned: shape.nreturned,
    ...(hasPlan && {
      planCacheShapeHash: planHash,
      queryHash: planHash,
      planCacheKey: shapeHash.slice(8, 16).toUpperCase(),
    }),
    queryFramework: "classic",
    locks: {
      Global: { acquireCount: { r: numYields + BASE_LOCK_ACQUISITIONS } },
    },
    readConcern: { level: "local", provenance: "implicitDefault" },
    writeConcern: { w: "majority", wtimeout: 0, provenance: "customDefault" },
    storage: {},
    protocol: "op_msg",
    workingMillis: Math.round(shape.workingMillis * spread),
    durationMillis: Math.round(shape.durationMillis * spread),
  };
}

/**
 * Line `index` of a shape. The header is padded as `mongod` pads it
 * (`"s":"I",  "c":"COMMAND",  "id":51803,   "ctx"`), so the line is built as
 * text, not with one `JSON.stringify`.
 */
export function slowLogLine(
  shape: SlowLogShape,
  command: Record<string, unknown>,
  index: number,
): string {
  const t = JSON.stringify({ $date: isoOffset(START_MS + index * GAP_MS) });
  const ctx = JSON.stringify(`conn${FIRST_CONNECTION + (index % CONNECTIONS)}`);
  const attr = JSON.stringify(attrFor(shape, command, index));
  return `{"t":${t},"s":"I",  "c":"COMMAND",  "id":51803,   "ctx":${ctx},"msg":"Slow query","attr":${attr}}`;
}
