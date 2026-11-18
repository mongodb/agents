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

import { READ_ONLY_MCP_TOOLS } from "@mongodb-js/atlas-explorer-agent";
import {
  MANAGED_MCP_TOOLS,
  serverToolName,
} from "@mongodb-js/atlas-agents-eval/tools";
import { ATLAS_QUERY_INSIGHTS_MCP_TOOLS } from "@mongodb-js/atlas-query-insights-agent";
import { describe, expect, it } from "vitest";

/** Tools the agents allow that the local server has no equivalent for. */
const MANAGED_SERVICE_ONLY = ["remote-atlas-connect"];

describe("managed tools", () => {
  // The harness's contract test keeps MANAGED_MCP_TOOLS equal to what the
  // installed mongodb-mcp-server offers, so this needs no server.
  it("include every tool the agents allow, bar the managed-only ones", () => {
    const wanted = [
      ...new Set([...READ_ONLY_MCP_TOOLS, ...ATLAS_QUERY_INSIGHTS_MCP_TOOLS]),
    ]
      .map(serverToolName)
      .filter((n): n is string => n !== undefined)
      .filter((n) => !MANAGED_SERVICE_ONLY.includes(n));
    expect(MANAGED_MCP_TOOLS).toEqual(expect.arrayContaining(wanted));
  });
});
