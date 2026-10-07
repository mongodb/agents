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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { RIG_DIR } from "./config.ts";
import {
  EXPLORER_READ_TOOLS,
  QUERY_INSIGHTS_TOOLS,
  isNonReadTool,
  toolMatches,
} from "./toolsets.ts";

function toolNamesInSetLiteral(file: string, constName: string): string[] {
  const source = readFileSync(path.join(RIG_DIR, "..", file), "utf8");
  const start = source.indexOf(constName);
  assert.ok(start >= 0, `${constName} not found in ${file}`);
  const body = source.slice(start, source.indexOf("]);", start));
  return [...body.matchAll(/"(mongodb__[a-z_]+)"/g)].map((match) => match[1]!).sort();
}

test("Explorer read tools match agentPolicy.ts", () => {
  assert.deepEqual(
    [...EXPLORER_READ_TOOLS].sort(),
    toolNamesInSetLiteral("packages/atlas-explorer-agent/src/agentPolicy.ts", "READ_ONLY_MCP_TOOLS"),
  );
});

test("Query Insights tools match toolPolicy.ts", () => {
  assert.deepEqual(
    [...QUERY_INSIGHTS_TOOLS].sort(),
    toolNamesInSetLiteral(
      "packages/atlas-query-insights-agent/src/toolPolicy.ts",
      "ATLAS_QUERY_INSIGHTS_MCP_TOOLS",
    ),
  );
});

test("toolMatches supports * wildcards", () => {
  assert.ok(toolMatches("mongodb__drop_*", "mongodb__drop_collection"));
  assert.ok(toolMatches("mongodb__list_*", "mongodb__list_databases"));
  assert.ok(!toolMatches("mongodb__list_*", "mongodb__atlas_list_projects"));
  assert.ok(toolMatches("*list_projects", "mongodb__atlas_list_projects"));
});

test("isNonReadTool flags MCP writes, off-list tools, and sandbox writes", () => {
  assert.ok(isNonReadTool("readonly", "mongodb__delete_many"));
  assert.ok(isNonReadTool("readonly", "write_file"));
  assert.ok(!isNonReadTool("readonly", "mongodb__find"));
  assert.ok(!isNonReadTool("readonly", "read_file"));
  assert.ok(isNonReadTool("queryInsights", "mongodb__atlas_list_db_users"));
});
