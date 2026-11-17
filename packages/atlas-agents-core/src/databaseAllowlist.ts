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

import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { AGGREGATE_WRITE_TOOLS } from "./aggregateWriteApproval.js";
import {
  isRecord,
  rejectToolCall,
  toolArgs,
  type ClusterToolCall,
} from "./clusterAllowlist.js";
import {
  createDatabaseMatcher,
  describeAllowedDatabases,
  type DatabaseMatcher,
  type DatabaseNamesConfig,
} from "./databaseNames.js";

// These MongoDB MCP tools take no `database` argument.
const TOOLS_WITHOUT_DATABASE: ReadonlySet<string> = new Set([
  "mongodb__list_databases",
  "mongodb__remote_atlas_connect",
]);

const MAX_PIPELINE_DEPTH = 20;

class UncheckableArgumentsError extends Error {}

/**
 * Returns why a MongoDB MCP call falls outside `databaseNames`, or
 * `undefined` when it may run. Checks:
 * - Each data tool call's `database` argument.
 * - The `$out` or `$merge` target database in aggregate pipelines.
 * - `namespaces` in `atlas_get_performance_advisor`.
 * - Stream processor databases in `atlas_streams_build` and
 *   `atlas_streams_manage`.
 */
export function findDatabaseViolation({
  databaseNames,
  matches,
  toolCall,
}: {
  databaseNames: DatabaseNamesConfig;
  matches: DatabaseMatcher;
  toolCall: ClusterToolCall;
}): string | undefined {
  const { name } = toolCall;
  if (TOOLS_WITHOUT_DATABASE.has(name)) return undefined;

  const args = toolArgs(toolCall.args);
  let usedDatabases: string[];
  try {
    if (name.startsWith("mongodb__atlas_")) {
      usedDatabases = findAtlasToolDatabases({ name, args });
    } else {
      const database = readNonEmptyString(args.database);
      if (!database) {
        return `${name} needs a database from the databaseNames allowlist.`;
      }
      const writeStageDatabases = findPipelines({ name, args }).flatMap(
        (pipeline) => findWriteStageDatabases({ pipeline }),
      );
      usedDatabases = [database, ...writeStageDatabases];
    }
  } catch (error) {
    if (error instanceof UncheckableArgumentsError) return error.message;
    throw error;
  }

  const disallowed = [...new Set(usedDatabases)].filter(
    (usedDatabase) => !matches(usedDatabase),
  );
  if (disallowed.length === 0) return undefined;
  return describeDisallowedDatabases({ databaseNames, disallowed });
}

// Most `mongodb__atlas_*` tools are control plane tools with no database
// arguments. `atlas_get_performance_advisor` can filter slow query logs
// by `db.collection` namespaces. `atlas_streams_build` and
// `atlas_streams_manage` can name databases in a processor pipeline and
// in its `dlq`.
function findAtlasToolDatabases({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}): string[] {
  if (name === "mongodb__atlas_get_performance_advisor") {
    return findPerformanceAdvisorDatabases(args);
  }
  if (
    name === "mongodb__atlas_streams_build" ||
    name === "mongodb__atlas_streams_manage"
  ) {
    return findStreamProcessorDatabases(args);
  }
  return [];
}

function findStreamProcessorDatabases(
  args: Record<string, unknown>,
): string[] {
  const databases: string[] = [];
  if (args.dlq !== undefined) {
    databases.push(readStreamDlqDatabase(args.dlq));
  }
  if (args.pipeline !== undefined) {
    databases.push(...findStreamPipelineDatabases(args.pipeline));
  }
  return databases;
}

function readStreamDlqDatabase(dlq: unknown): string {
  const parsed = parseJsonString(dlq);
  const database = isRecord(parsed) ? readNonEmptyString(parsed.db) : undefined;
  if (!database) {
    throw new UncheckableArgumentsError(
      "Stream processor dlq must include a database name in db.",
    );
  }
  return database;
}

function findStreamPipelineDatabases(pipeline: unknown): string[] {
  const parsed = parseJsonString(pipeline);
  if (!Array.isArray(parsed)) {
    throw new UncheckableArgumentsError(
      "A stream processor pipeline must be an array of stages, so databaseNames can check its databases.",
    );
  }
  return collectStreamStageDatabases({ stages: parsed, depth: 0 });
}

// Only the stage keys in STREAM_DATABASE_STAGES can name a database, and
// only the `pipeline` field of STREAM_SUB_PIPELINE_STAGES stages holds
// sub-pipelines of stages. Everything else in a stage is data, such as a
// `$literal` payload or `$source.documents`, and is never read.
const STREAM_DATABASE_STAGES = new Set([
  "$source",
  "$lookup",
  "$merge",
  "$out",
]);
const STREAM_SUB_PIPELINE_STAGES = new Set([
  "$source",
  "$tumblingWindow",
  "$hoppingWindow",
  "$sessionWindow",
]);

function collectStreamStageDatabases({
  stages,
  depth,
}: {
  stages: unknown[];
  depth: number;
}): string[] {
  if (depth > MAX_PIPELINE_DEPTH) {
    throw new UncheckableArgumentsError(
      `A pipeline nests deeper than ${MAX_PIPELINE_DEPTH} levels, so databaseNames cannot check it.`,
    );
  }
  return stages.flatMap((stage) => {
    if (!isRecord(stage)) return [];
    return Object.entries(stage).flatMap(([key, value]) => {
      const stageDatabases = STREAM_DATABASE_STAGES.has(key)
        ? maybeDatabase(readStreamStageDatabase(key as StreamDatabaseStage, value))
        : [];
      const subPipelineDatabases =
        STREAM_SUB_PIPELINE_STAGES.has(key) &&
        isRecord(value) &&
        value.pipeline !== undefined
          ? collectStreamStageDatabases({
              stages: readStreamSubPipeline(value.pipeline),
              depth: depth + 1,
            })
          : [];
      return [...stageDatabases, ...subPipelineDatabases];
    });
  });
}

function readStreamSubPipeline(value: unknown): unknown[] {
  const parsed = parseJsonString(value);
  if (!Array.isArray(parsed)) {
    throw new UncheckableArgumentsError(
      "A stream processor sub-pipeline must be an array of stages, so databaseNames can check its databases.",
    );
  }
  return parsed;
}

function maybeDatabase(database: string | undefined): string[] {
  return database ? [database] : [];
}

type StreamDatabaseStage = "$source" | "$lookup" | "$merge" | "$out";

function readStreamStageDatabase(
  stage: StreamDatabaseStage,
  value: unknown,
): string | undefined {
  if (!isRecord(value)) {
    throw new UncheckableArgumentsError(
      `Stream processor ${stage} stage must be an object, so databaseNames can check its database.`,
    );
  }
  if (stage === "$source") {
    // Kafka, Kinesis, inline document, and cluster-wide change stream sources
    // do not name a database. A collection source names `db` (and `coll`).
    if (value.db === undefined && value.coll === undefined) return undefined;
    const database = readNonEmptyString(value.db);
    if (!database) {
      throw new UncheckableArgumentsError(
        "Stream processor $source stage must include a string db.",
      );
    }
    return database;
  }
  if (stage === "$lookup") {
    // { $lookup: { connectionName: "c", from: { db: "orders", coll: "users" } } }
    const database = readDbField(value.from);
    if (!database) {
      throw new UncheckableArgumentsError(
        "Stream processor $lookup stage must include a string from.db.",
      );
    }
    return database;
  }
  if (stage === "$merge") {
    // { $merge: { into: { connectionName: "c", db: "orders", coll: "out" } } }
    const database = readDbField(value.into) ?? readDbField(value);
    if (!database) {
      throw new UncheckableArgumentsError(
        "Stream processor $merge stage must include a string into.db.",
      );
    }
    return database;
  }
  // { $out: { db: "orders", coll: "out" } }
  const database = readDbField(value);
  if (!database) {
    throw new UncheckableArgumentsError(
      "Stream processor $out stage must include a string db.",
    );
  }
  return database;
}

function findPerformanceAdvisorDatabases(
  args: Record<string, unknown>,
): string[] {
  if (args.namespaces === undefined) return [];
  const namespaces = parseJsonString(args.namespaces);
  if (!Array.isArray(namespaces)) {
    throw new UncheckableArgumentsError(
      "mongodb__atlas_get_performance_advisor namespaces must be an array of db.collection strings.",
    );
  }
  return namespaces.map(readNamespaceDatabase);
}

function readNamespaceDatabase(namespace: unknown): string {
  if (typeof namespace !== "string") {
    throw new UncheckableArgumentsError(
      "mongodb__atlas_get_performance_advisor namespaces must be db.collection strings.",
    );
  }
  const dotIndex = namespace.indexOf(".");
  if (dotIndex <= 0 || dotIndex === namespace.length - 1) {
    throw new UncheckableArgumentsError(
      "mongodb__atlas_get_performance_advisor namespaces must be db.collection strings.",
    );
  }
  return namespace.slice(0, dotIndex);
}

function describeDisallowedDatabases({
  databaseNames,
  disallowed,
}: {
  databaseNames: DatabaseNamesConfig;
  disallowed: string[];
}): string {
  const names = disallowed.join(", ");
  if (databaseNames.length === 0) {
    return `No databases are allowed by databaseNames, so ${names} cannot be used.`;
  }
  const subject =
    disallowed.length === 1 ? `Database ${names} is` : `Databases ${names} are`;
  return `${subject} not in the databaseNames allowlist. Allowed: ${describeAllowedDatabases(databaseNames)}.`;
}

// The only tool arguments that hold an aggregation pipeline. Every other
// argument is data, such as a filter or a document, and is never read for
// write stages.
function findPipelines({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}): unknown[] {
  if (AGGREGATE_WRITE_TOOLS.has(name)) return [args.pipeline];
  if (name !== "mongodb__explain") return [];
  const methods = parseJsonString(args.method);
  if (!Array.isArray(methods)) return [];
  return methods.flatMap((method) => {
    if (!isRecord(method) || method.name !== "aggregate") return [];
    const methodArguments = parseJsonString(method.arguments);
    return isRecord(methodArguments) ? [methodArguments.pipeline] : [];
  });
}

// Finds the databases that the stages of one aggregation pipeline write to.
// `$out: { db }` and `$merge: { into: { db } }` are the stages documented to
// write to another database. Strings inside the pipeline are values, so they
// are not parsed.
function findWriteStageDatabases({
  pipeline,
}: {
  pipeline: unknown;
}): string[] {
  const parsed = parseJsonString(pipeline);
  if (typeof parsed === "string" && mentionsWriteStage(parsed)) {
    throw new UncheckableArgumentsError(
      "A pipeline with $out or $merge could not be parsed, so databaseNames cannot check its target database.",
    );
  }
  return collectWriteStageDatabases({ value: parsed, depth: 0 });
}

function collectWriteStageDatabases({
  value,
  depth,
}: {
  value: unknown;
  depth: number;
}): string[] {
  if (!Array.isArray(value) && !isRecord(value)) return [];
  if (depth > MAX_PIPELINE_DEPTH) {
    throw new UncheckableArgumentsError(
      `A pipeline nests deeper than ${MAX_PIPELINE_DEPTH} levels, so databaseNames cannot check it.`,
    );
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      collectWriteStageDatabases({ value: item, depth: depth + 1 }),
    );
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const nestedDatabases = collectWriteStageDatabases({
      value: child,
      depth: depth + 1,
    });
    if (key !== "$out" && key !== "$merge") return nestedDatabases;
    const stageDatabase = readWriteStageDatabase(key, child);
    return stageDatabase
      ? [stageDatabase, ...nestedDatabases]
      : nestedDatabases;
  });
}

// A plain string stage, as in `{ $out: "c" }`, writes to the database the
// call already names, so it yields no database here.
function readWriteStageDatabase(
  stage: "$out" | "$merge",
  value: unknown,
): string | undefined {
  if (!isRecord(value)) return undefined;
  if (stage === "$merge") {
    // { $merge: { into: { db: "archive", coll: "c" } } }
    return readDbField(value.into);
  }
  // { $out: { db: "archive", coll: "c" } }
  return readDbField(value);
}

function readDbField(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return readNonEmptyString(value.db);
}

// Database names are compared exactly as the MCP receives them. Trimming
// here would let " orders" pass as "orders" while naming another database.
function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("[") || trimmed.startsWith("{");
}

function mentionsWriteStage(value: string): boolean {
  return value.includes("$out") || value.includes("$merge");
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string" || !looksLikeJson(value)) return value;
  try {
    return parseJsonString(JSON.parse(value));
  } catch {
    return value;
  }
}

export async function guardDatabaseCall<
  TRequest extends { toolCall?: ClusterToolCall },
  TResult,
>({
  databaseNames,
  matches,
  request,
  handler,
}: {
  databaseNames: DatabaseNamesConfig;
  matches: DatabaseMatcher;
  request: TRequest;
  handler: (request: TRequest) => TResult | Promise<TResult>;
}): Promise<TResult | ToolMessage> {
  const toolCall = request.toolCall;
  if (!toolCall?.name.startsWith("mongodb__")) return handler(request);
  const violation = findDatabaseViolation({ databaseNames, matches, toolCall });
  if (violation) return rejectToolCall({ toolCall, reason: violation });
  return handler(request);
}

/**
 * Rejects MongoDB MCP calls that name a database outside `databaseNames`.
 * With no argument, every call runs unchanged. With `[]`, every call that
 * needs a database is rejected.
 */
export function databaseAllowlistMiddleware(
  databaseNames?: DatabaseNamesConfig,
) {
  const matches = createDatabaseMatcher(databaseNames);
  return createMiddleware({
    name: "databaseAllowlist",
    wrapToolCall: (request, handler) =>
      databaseNames && matches
        ? guardDatabaseCall({ databaseNames, matches, request, handler })
        : handler(request),
  });
}
