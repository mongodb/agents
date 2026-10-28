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

import type { AtlasQueryInsightsConfig } from "./agentConfig.js";
import { buildAtlasQueryInsightsAgentOptions } from "./agentOptions.js";

const config: AtlasQueryInsightsConfig = {
  llm: { provider: "openai", model: "test-model" },
  systemPrompt: {
    name: "Test Insights",
    customInstructions: "",
    defaultData: {},
  },
  dataAccess: {},
  inputGuard: { mode: "enforce" },
  maxQueryShapes: 3,
};

const tools = [
  { name: "mongodb__atlas_get_performance_advisor" },
  { name: "mongodb__find" },
  { name: "mongodb__atlas_create_cluster" },
  { name: "mongodb__atlas_create_db_user" },
  { name: "search_knowledge" },
];

const names = (items: readonly { name: string }[]) =>
  items.map((item) => item.name);

describe("buildAtlasQueryInsightsAgentOptions", () => {
  it("keeps the middleware order the agent relies on", () => {
    const { middleware } = buildAtlasQueryInsightsAgentOptions({
      config,
      tools,
    });
    expect(names(middleware)).toEqual([
      "inputRefusal",
      "stampResumeClientUser",
      "stripOpenAIToolEcho",
      "redactSecrets",
      "clusterAllowlist",
      "databaseAllowlist",
      "rejectAggregateWrites",
      "recoverToolErrors",
    ]);
  });

  it("never exposes write tools", () => {
    const options = buildAtlasQueryInsightsAgentOptions({ config, tools });
    expect(names(options.tools)).toEqual([
      "mongodb__atlas_get_performance_advisor",
      "mongodb__find",
      "search_knowledge",
    ]);
  });

  it("builds the prompt from the config", () => {
    const options = buildAtlasQueryInsightsAgentOptions({ config, tools });
    expect(options.systemPrompt).toContain("Test Insights");
    expect(options.skills).toEqual(["skills"]);
  });
});
