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
  createAgentEvalCli,
  type AgentEvalCli,
  type AgentEvalCliOptions,
  type AgentEvalDataset,
  type AgentEvalScorer,
} from "./agentEvalCli.js";
export { readAgentFiles } from "./agentFiles.js";
export type {
  AgentDefinition,
  BuildAgentOptionsArgs,
  BuiltAgentOptions,
} from "./agents/definition.js";
export {
  DEEP_AGENT_BUILT_IN_TOOLS,
  KNOWN_AGENT_TOOLS,
  loadAgentCasesFromFile,
  parseAgentCases,
  type AgentCaseOptions,
  type AgentEvalCase,
} from "./cases.js";
export {
  contentToText,
  convertLangchainMessagesToAssistantEvalMessages,
} from "./convertLangchainMessagesToAssistantEvalMessages.js";
export { ExecutionRecorder, type ExecutedToolCall } from "./executionRecorder.js";
export {
  createFixtureStore,
  type FixtureField,
  type FixtureStore,
  type FixtureStoreOptions,
  type NamedToolSetup,
} from "./fixtures.js";
export {
  DEFAULT_JUDGE_ENDPOINT,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_JUDGE_REASONING_EFFORT,
  judgeModelConfig,
  type JudgeModelOptions,
} from "./judge.js";
export {
  knowledgeSourceUrls,
  knowledgeToolErrors,
  type KnowledgeToolError,
} from "./knowledgeSources.js";
export { makeChatModel, type ModelConfig } from "./models.js";
export type { MongoCheck } from "./mongoChecks/index.js";
export {
  AgentEvalCaseSchema,
  CustomExpectedSchema,
  CustomInputSchema,
  makeAgentEvalCaseSchema,
  type AgentEvalCaseSchemaOptions,
  type AnyAgentEvalCaseSchema,
  type CustomExpected,
  type CustomInput,
} from "./schemas.js";
export { ScriptedChatModel, type ScriptedTurn } from "./scriptedModel.js";
export {
  makeAgentTask,
  PRECONFIGURED_CONNECTION_NOTE,
  type AgentTaskInput,
  type AgentTaskOptions,
  type AgentTaskOutput,
  type AgentTaskOutputCustom,
  type MongoCheckResult,
} from "./task.js";
