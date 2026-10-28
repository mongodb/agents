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

import { buildAtlasQueryInsightsAgentOptions } from "@repo/atlas-query-insights-agent";

import { atlasQueryInsightsConfig } from "../../../../agents/atlas-query-insights/src/agent_atlas_query_insights/config.js";
import { agentDirectory } from "../paths.js";
import type { AgentDefinition } from "./definition.js";

export const atlasQueryInsightsAgent: AgentDefinition = {
  name: "atlas-query-insights",
  agentDir: agentDirectory("atlas-query-insights"),
  inputGuardMode: atlasQueryInsightsConfig.inputGuard.mode,
  supportsWrites: false,
  buildOptions({ tools, defaultData }) {
    return buildAtlasQueryInsightsAgentOptions({
      config: defaultData
        ? {
            ...atlasQueryInsightsConfig,
            systemPrompt: {
              ...atlasQueryInsightsConfig.systemPrompt,
              defaultData,
            },
          }
        : atlasQueryInsightsConfig,
      tools,
    });
  },
};
