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

export {
  AREA_RULE_IDS,
  DEFAULT_AGENT_NAME,
  DEFAULT_MAX_QUERY_SHAPES,
  FORMATTING_RULE_IDS,
  METRIC_USAGE_RULE_IDS,
  OVERVIEW_RULE_IDS,
  PA_INDEX_SUGGESTION_CTA,
  PA_NO_SUGGESTION_RULE_IDS,
  PA_PRESENT_RULE_IDS,
  ATLAS_QUERY_INSIGHTS_RULE_IDS,
  NO_CLUSTER_CONFIGURED,
  WRITING_STYLE_RULE_IDS,
  buildSystemPrompt,
  type SystemPromptOptions,
} from "./systemMessage.js";
export {
  surfaceTokenMintFailures,
  rejectAggregateWritesMiddleware,
  buildLLM,
  createInputRefusalMiddleware,
  createInputRedactor,
  prepareAgentInput,
  recoverToolErrorsMiddleware,
  redactSecretsMiddleware,
  stampClientUser,
  stampResumeClientUserMiddleware,
  stripToolEchoMiddleware,
  withRequesterMetadata,
  withoutShellExecution,
  type DataAccessConfig,
  type InputGuardConfig,
} from "@repo/agent-engine-core";
export {
  ATLAS_QUERY_INSIGHTS_MCP_TOOLS,
  selectAtlasQueryInsightsTools,
} from "./toolPolicy.js";
