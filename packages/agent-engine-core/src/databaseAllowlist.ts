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
 * `undefined` when it may run. Checks the `database` argument and the
 * database that `$out` or `$merge` writes to.
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
  // `mongodb__atlas_*` tools are control plane tools. The cluster allowlist
  // handles them.
  if (name.startsWith("mongodb__atlas_") || TOOLS_WITHOUT_DATABASE.has(name)) {
    return undefined;
  }

  const args = toolArgs(toolCall.args);
  const database = readNonEmptyString(args.database);
  if (!database) {
    return `${name} needs a database from the databaseNames allowlist.`;
  }

  let writeStageDatabases: string[];
  try {
    writeStageDatabases = findPipelines({ name, args }).flatMap((pipeline) =>
      findWriteStageDatabases({ pipeline }),
    );
  } catch (error) {
    if (error instanceof UncheckableArgumentsError) return error.message;
    throw error;
  }

  const disallowed = [...new Set([database, ...writeStageDatabases])].filter(
    (usedDatabase) => !matches(usedDatabase),
  );
  if (disallowed.length === 0) return undefined;
  return describeDisallowedDatabases({ databaseNames, disallowed });
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
