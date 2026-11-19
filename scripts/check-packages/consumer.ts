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

// This file runs in an empty project that has only the packed tarballs
// installed. The imports below are arbitrary public exports, picked so each
// entry point of each package is loaded once. They are not exercised for
// behavior: if tsc can resolve them and tsx can load them, the published
// package built and its exports map, types and dependencies are intact.
import { buildLLM, registerKnowledgeTools } from "@mongodb-js/atlas-agents-core";
import {
  runSkillsCli,
  syncSkills,
} from "@mongodb-js/atlas-agents-core/sync-skills";
import { AgentEngineClient } from "@mongodb-js/agent-engine-chat/agent-engine";
import { registerChatHandlers } from "@mongodb-js/agent-engine-chat/chat";
import {
  createSlackDeliveryBoundary,
  createSlackPlatformAdapter,
  parseSlackReviewInterruptId,
  registerSlackAppHomeHandler,
  splitSlackResponse,
} from "@mongodb-js/agent-engine-chat/slack";
import { MongoThreadStore } from "@mongodb-js/agent-engine-chat/store";
import {
  createAgentEvalCli,
  makeAgentTask,
} from "@mongodb-js/atlas-agents-eval";
import { startMockAtlasApi } from "@mongodb-js/atlas-agents-eval/atlas";
import { startEphemeralMongo } from "@mongodb-js/atlas-agents-eval/mongo";
import { AnswerMatches } from "@mongodb-js/atlas-agents-eval/scorers";
import { createLocalToolProvider } from "@mongodb-js/atlas-agents-eval/tools";
import { startMockBraintrust } from "@mongodb-js/atlas-agents-eval/testing";
import { buildAtlasExplorerAgentOptions } from "@mongodb-js/atlas-explorer-agent";
import { buildAtlasQueryInsightsAgentOptions } from "@mongodb-js/atlas-query-insights-agent";

const exportsUnderTest = {
  buildLLM,
  registerKnowledgeTools,
  runSkillsCli,
  syncSkills,
  AgentEngineClient,
  registerChatHandlers,
  createSlackDeliveryBoundary,
  createSlackPlatformAdapter,
  parseSlackReviewInterruptId,
  registerSlackAppHomeHandler,
  splitSlackResponse,
  MongoThreadStore,
  buildAtlasExplorerAgentOptions,
  buildAtlasQueryInsightsAgentOptions,
  createAgentEvalCli,
  makeAgentTask,
  startMockAtlasApi,
  startEphemeralMongo,
  AnswerMatches,
  createLocalToolProvider,
  startMockBraintrust,
};

for (const [name, value] of Object.entries(exportsUnderTest)) {
  if (typeof value !== "function") {
    throw new Error(`${name} is not exported as a function`);
  }
}
console.log(`Imported ${Object.keys(exportsUnderTest).length} exports`);
