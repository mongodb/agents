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
  PERFORMANCE_ADVISOR_TOOL,
  SLOW_QUERY_SAMPLE_LIMIT,
  annotatePerformanceAdvisorCall,
  annotatePerformanceAdvisorMiddleware,
  buildPerformanceAdvisorEvidence,
} from "./performanceAdvisorEvidence.js";
export {
  NOT_AVAILABLE,
  UNITS_LEGEND,
  display as displayQueryStat,
  displayedStats,
} from "./queryStatsFormatter.js";
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
  WRITING_STYLE_RULE_IDS,
  buildSystemPrompt,
  type SystemPromptOptions,
} from "./systemMessage.js";
export {
  buildLLM,
  prepareAgentInput,
  recoverToolErrorsMiddleware,
  stampClientUser,
  stampResumeClientUserMiddleware,
  stripToolEchoMiddleware,
  withRequesterMetadata,
  withoutShellExecution,
} from "@repo/agent-engine-core";
export {
  describeScope,
  resolveScope,
  type AtlasQueryInsightsScope,
  type ScopeInput,
} from "./scope.js";
export {
  ATLAS_QUERY_INSIGHTS_MCP_TOOLS,
  selectAtlasQueryInsightsTools,
} from "./toolPolicy.js";
