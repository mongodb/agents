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

import type {
  createInputRedactor,
  createInputRefusalMiddleware,
} from "@repo/atlas-query-insights-agent";

/**
 * Non-secret Atlas Query Insights settings.
 *
 * Leave `systemPrompt.name` empty to keep "Atlas Query Insights".
 * Leave `systemPrompt.customInstructions` empty to skip extra prompt text.
 * Leave `scope.projectId` and `scope.clusterName` empty to let the agent
 * resolve the target. A set field must be a 24-hex project id or an Atlas
 * cluster name. `maxQueryShapes` is how many shapes the report covers.
 *
 * `inputGuard` screens each user message before the model sees it: it redacts
 * pasted secrets and refuses messages that are too long to screen. `mode` is
 * "enforce", "monitor" (log only) or "off". See
 * {@link createInputRedactor} and {@link createInputRefusalMiddleware}.
 */

export const atlasQueryInsightsConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6.1-sol",
  },
  systemPrompt: {
    name: "",
    customInstructions: "",
  },
  scope: {
    projectId: "",
    clusterName: "",
  },
  maxQueryShapes: 3,
  inputGuard: {
    mode: "enforce",
  },
} as const;
