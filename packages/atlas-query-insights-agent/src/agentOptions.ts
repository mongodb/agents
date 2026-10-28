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

import type { AgentMiddleware } from "langchain";

import {
  clusterAllowlistMiddleware,
  createInputRefusalMiddleware,
  databaseAllowlistMiddleware,
  recoverToolErrorsMiddleware,
  redactSecretsMiddleware,
  rejectAggregateWritesMiddleware,
  stampResumeClientUserMiddleware,
  stripToolEchoMiddleware,
  type DataAccessConfig,
} from "@repo/agent-engine-core";

import type { AtlasQueryInsightsConfig } from "./agentConfig.js";
import { buildSystemPrompt } from "./systemMessage.js";
import { selectAtlasQueryInsightsTools } from "./toolPolicy.js";

export interface AtlasQueryInsightsAgentOptionsInput<
  Tool extends { name: string },
> {
  readonly config: AtlasQueryInsightsConfig;
  /** Every tool the runtime discovered, before the agent's tool policy. */
  readonly tools: readonly Tool[];
}

export interface AtlasQueryInsightsAgentOptions<Tool extends { name: string }> {
  readonly tools: Tool[];
  readonly systemPrompt: string;
  readonly skills: string[];
  readonly middleware: AgentMiddleware[];
}

/**
 * The prompt, tools, skills, and middleware of the Atlas Query Insights
 * deep agent. Runtime plumbing (model, backend, checkpointer) is not part
 * of it: `main.ts` supplies the Agent Engine ones and the eval harness
 * supplies local ones, so both run the same agent.
 */
export function buildAtlasQueryInsightsAgentOptions<
  Tool extends { name: string },
>({
  config,
  tools,
}: AtlasQueryInsightsAgentOptionsInput<Tool>): AtlasQueryInsightsAgentOptions<Tool> {
  // Typed so `databaseNames` type-checks even when config.ts sets only `projects`.
  const dataAccess: DataAccessConfig = config.dataAccess;

  return {
    tools: selectAtlasQueryInsightsTools(tools),
    systemPrompt: buildSystemPrompt({
      name: config.systemPrompt.name,
      customInstructions: config.systemPrompt.customInstructions,
      defaultData: config.systemPrompt.defaultData,
      dataAccess,
      maxQueryShapes: config.maxQueryShapes,
    }),
    skills: ["skills"],
    middleware: [
      createInputRefusalMiddleware({ mode: config.inputGuard.mode }),
      stampResumeClientUserMiddleware,
      stripToolEchoMiddleware,
      redactSecretsMiddleware,
      clusterAllowlistMiddleware(dataAccess),
      databaseAllowlistMiddleware(dataAccess.databaseNames),
      rejectAggregateWritesMiddleware,
      recoverToolErrorsMiddleware,
    ],
  };
}
