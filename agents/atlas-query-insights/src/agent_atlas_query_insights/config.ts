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

/**
 * Non-secret Atlas Query Insights settings.
 *
 * Leave `systemPrompt.name` empty to keep "Atlas Query Insights".
 * Leave `systemPrompt.customInstructions` empty to skip extra prompt text.
 * Leave `dataAccess` as `{}` for no restriction: every project and cluster
 * the MCP configuration can reach. Otherwise map each allowed 24-hex project
 * id to `{}` (all its clusters) or `{ clusterNames: [...] }`.
 * `maxQueryShapes` is how many shapes the report covers.
 */

import type { DataAccessConfig } from "@repo/atlas-query-insights-agent";

export const atlasQueryInsightsConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6.1-sol",
  },
  systemPrompt: {
    name: "",
    customInstructions: "",
  },
  dataAccess: {} satisfies DataAccessConfig,
  maxQueryShapes: 3,
} as const;
