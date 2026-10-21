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

import {
  isRecord,
  rejectToolCall,
  stringArg,
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

const MAX_ARGUMENT_DEPTH = 20;
const WRITE_STAGE_WITH_UNREADABLE_TARGET = /\$(?:out|merge)\s*"?\s*:/;

class UncheckableArgumentsError extends Error {}

/**
 * Returns why a MongoDB MCP call falls outside `databaseNames`, or
 * `undefined` when it may run. Arguments are never rewritten.
 *
 * Checks the `database` argument and the target database of `$out` and
 * `$merge`. It does not inspect other parts of an aggregation pipeline.
 * `$lookup` and `$unionWith` read only from the same database in current
 * MongoDB versions, but if a future version allows cross-database reads,
 * this check will not catch them. It is a guardrail on the agent, not a
 * security boundary.
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
  const database = stringArg(args.database);
  if (!database) {
    return `${name} needs a database from the databaseNames allowlist.`;
  }
  const violation = findNameViolation({ databaseNames, matches, database });
  if (violation) return violation;

  let targets: string[];
  try {
    targets = writeTargetDatabases({ value: args });
  } catch (error) {
    if (error instanceof UncheckableArgumentsError) return error.message;
    throw error;
  }
  for (const target of targets) {
    const targetViolation = findNameViolation({
      databaseNames,
      matches,
      database: target,
    });
    if (targetViolation) return targetViolation;
  }
  return undefined;
}

function findNameViolation({
  databaseNames,
  matches,
  database,
}: {
  databaseNames: DatabaseNamesConfig;
  matches: DatabaseMatcher;
  database: string;
}): string | undefined {
  if (matches(database)) return undefined;
  if (databaseNames.length === 0) {
    return `No databases are allowed by databaseNames, so database ${database} cannot be used.`;
  }
  return `Database ${database} is not in the databaseNames allowlist. Allowed: ${describeAllowedDatabases(databaseNames)}.`;
}

// `$out: { db }` and `$merge: { into: { db } }` are the stages documented to
// write to another database. Only those keys are read, so a filter on a
// field named `db` is not mistaken for a target.
function writeTargetDatabases({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): string[] {
  const parsed = parseJsonString(value);
  if (typeof parsed === "string") {
    if (WRITE_STAGE_WITH_UNREADABLE_TARGET.test(parsed)) {
      throw new UncheckableArgumentsError(
        "A pipeline with $out or $merge could not be parsed, so databaseNames cannot check its target database.",
      );
    }
    return [];
  }
  if (!Array.isArray(parsed) && !isRecord(parsed)) return [];
  if (depth > MAX_ARGUMENT_DEPTH) {
    throw new UncheckableArgumentsError(
      `Tool call arguments nest deeper than ${MAX_ARGUMENT_DEPTH} levels, so databaseNames cannot check them.`,
    );
  }
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) =>
      writeTargetDatabases({ value: item, depth: depth + 1 }),
    );
  }
  return Object.entries(parsed).flatMap(([key, child]) => {
    const nested = writeTargetDatabases({ value: child, depth: depth + 1 });
    const own = key === "$out" || key === "$merge" ? stageTarget(key, child) : [];
    return [...own, ...nested];
  });
}

function stageTarget(stage: "$out" | "$merge", value: unknown): string[] {
  const config = parseJsonString(value);
  if (!isRecord(config)) return [];
  const target = stage === "$out" ? config : parseJsonString(config.into);
  if (!isRecord(target)) return [];
  const db = stringArg(target.db);
  return db ? [db] : [];
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return parseJsonString(JSON.parse(trimmed));
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
