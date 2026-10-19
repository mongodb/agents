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
  approveAggregateWritesMiddleware,
  buildLLM,
  clientUserSchema,
  clusterAllowlistMiddleware,
  createInputRefusalMiddleware,
  createInputRedactor,
  formatToolErrorForAgent,
  isAgentEngineResume,
  parseClientUserPayload,
  prepareAgentInput as prepareAtlasExplorerInput,
  recoverToolCall,
  recoverToolErrorsMiddleware,
  redactSecretsMiddleware,
  requesterFromCheckpoint,
  resolveOpenAIResponsesApi,
  stampClientUser,
  startRuntimeDiagnostics,
  stampResumeClientUserMiddleware,
  stampResumeMessages,
  stripToolEchoMiddleware,
  surfaceTokenMintFailures,
  withRequesterMetadata,
  withoutShellExecution,
  type BuildLLMOptions,
  type ClientUser,
  type ClientUserExtras,
  type DataAccessConfig,
  type InputGuardConfig,
  type Requester,
} from "@repo/agent-engine-core";
export {
  HIGH_RISK_MCP_TOOLS,
  mutativeInterruptOn,
  READ_ONLY_MCP_TOOLS,
  selectAtlasTools,
  writeOperationsAllowed,
} from "./agentPolicy.js";
export {
  buildSystemPrompt,
  READ_ONLY_SYSTEM_PROMPT,
  WRITE_ENABLED_SYSTEM_PROMPT,
  type SystemPromptOptions,
} from "./systemMessage.js";
