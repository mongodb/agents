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

import type { AtlasExplorerConfig } from "./agentConfig.js";
import { buildAtlasExplorerAgentOptions } from "./agentOptions.js";

const config: AtlasExplorerConfig = {
  llm: { provider: "openai", model: "test-model" },
  systemPrompt: {
    name: "Test Explorer",
    customInstructions: "",
    defaultData: {},
  },
  dataAccess: {},
  diagnostics: { logRuntimeLifecycle: false },
  inputGuard: { mode: "enforce" },
};

const tools = [
  { name: "mongodb__find" },
  { name: "mongodb__atlas_list_clusters" },
  { name: "mongodb__atlas_create_cluster" },
  { name: "mongodb__atlas_create_db_user" },
  { name: "search_knowledge" },
];

const names = (items: readonly { name: string }[]) =>
  items.map((item) => item.name);

describe("buildAtlasExplorerAgentOptions", () => {
  it("keeps the middleware order the agent relies on", () => {
    const { middleware } = buildAtlasExplorerAgentOptions({
      config,
      tools,
      allowWriteOperations: true,
    });
    expect(names(middleware)).toEqual([
      "inputRefusal",
      "stampResumeClientUser",
      "stripOpenAIToolEcho",
      "redactSecrets",
      "clusterAllowlist",
      "HumanInTheLoopMiddleware",
      "approveAggregateWrites",
      "databaseAllowlist",
      "recoverToolErrors",
    ]);
  });

  it("hides write tools in read-only mode", () => {
    const options = buildAtlasExplorerAgentOptions({
      config,
      tools,
      allowWriteOperations: false,
    });
    expect(names(options.tools)).toEqual([
      "mongodb__find",
      "mongodb__atlas_list_clusters",
      "search_knowledge",
    ]);
    expect(options.systemPrompt).toContain("Test Explorer");
  });

  it("exposes write tools in write mode except the high-risk ones", () => {
    const options = buildAtlasExplorerAgentOptions({
      config,
      tools,
      allowWriteOperations: true,
    });
    expect(names(options.tools)).toEqual([
      "mongodb__find",
      "mongodb__atlas_list_clusters",
      "mongodb__atlas_create_cluster",
      "search_knowledge",
    ]);
  });

  it("loads skills from the agent directory", () => {
    const options = buildAtlasExplorerAgentOptions({
      config,
      tools,
      allowWriteOperations: false,
    });
    expect(options.skills).toEqual(["skills"]);
  });

  it("uses a different prompt in read-only and write mode", () => {
    const readOnly = buildAtlasExplorerAgentOptions({
      config,
      tools,
      allowWriteOperations: false,
    });
    const write = buildAtlasExplorerAgentOptions({
      config,
      tools,
      allowWriteOperations: true,
    });
    expect(write.systemPrompt).not.toEqual(readOnly.systemPrompt);
  });
});
