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

import { buildLLM, registerKnowledgeTools } from "@mongodb-js/agent-engine-core";
import {
  runSkillsCli,
  syncSkills,
} from "@mongodb-js/agent-engine-core/sync-skills";
import { AgentEngineClient } from "@mongodb-js/agent-engine-chat/agent-engine";
import { registerChatHandlers } from "@mongodb-js/agent-engine-chat/chat";
import { MongoThreadStore } from "@mongodb-js/agent-engine-chat/store";
import { buildAtlasExplorerAgentOptions } from "@mongodb-js/atlas-explorer-agent";
import { buildAtlasQueryInsightsAgentOptions } from "@mongodb-js/atlas-query-insights-agent";

const exportsUnderTest = {
  buildLLM,
  registerKnowledgeTools,
  runSkillsCli,
  syncSkills,
  AgentEngineClient,
  registerChatHandlers,
  MongoThreadStore,
  buildAtlasExplorerAgentOptions,
  buildAtlasQueryInsightsAgentOptions,
};

for (const [name, value] of Object.entries(exportsUnderTest)) {
  if (typeof value !== "function") {
    throw new Error(`${name} is not exported as a function`);
  }
}
console.log(`Imported ${Object.keys(exportsUnderTest).length} exports`);
