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

import { humanInTheLoopMiddleware } from "langchain";
import type { AgentMiddleware } from "langchain";

import {
  approveAggregateWritesMiddleware,
  clusterAllowlistMiddleware,
  createInputRefusalMiddleware,
  databaseAllowlistMiddleware,
  recoverToolErrorsMiddleware,
  redactSecretsMiddleware,
  stampResumeClientUserMiddleware,
  stripToolEchoMiddleware,
  type DataAccessConfig,
} from "@repo/agent-engine-core";

import type { AtlasExplorerConfig } from "./agentConfig.js";
import { mutativeInterruptOn, selectAtlasTools } from "./agentPolicy.js";
import { buildSystemPrompt } from "./systemMessage.js";

export interface AtlasExplorerAgentOptionsInput<T extends { name: string }> {
  readonly config: AtlasExplorerConfig;
  /** Every tool the runtime discovered, before the agent's tool policy. */
  readonly tools: readonly T[];
  /**
   * Whether write tools are exposed behind human approval. Callers pass
   * this explicitly. `main.ts` reads `ALLOW_WRITE_OPERATIONS`, the eval
   * harness takes it per case.
   */
  readonly allowWriteOperations: boolean;
}

export interface AtlasExplorerAgentOptions<T extends { name: string }> {
  readonly tools: T[];
  readonly systemPrompt: string;
  readonly skills: string[];
  readonly middleware: AgentMiddleware[];
}

/**
 * The prompt, tools, skills, and middleware of the Atlas Explorer deep
 * agent. Runtime plumbing (model, backend, checkpointer) is not part of
 * it: `main.ts` supplies the Agent Engine ones and the eval harness
 * supplies local ones, so both run the same agent.
 */
export function buildAtlasExplorerAgentOptions<T extends { name: string }>({
  config,
  tools,
  allowWriteOperations,
}: AtlasExplorerAgentOptionsInput<T>): AtlasExplorerAgentOptions<T> {
  // Typed so `databaseNames` type-checks even when config.ts sets only `projects`.
  const dataAccess: DataAccessConfig = config.dataAccess;
  const availableTools = selectAtlasTools(tools, allowWriteOperations);
  const mutativeToolReview = humanInTheLoopMiddleware({
    interruptOn: allowWriteOperations ? mutativeInterruptOn(availableTools) : {},
    descriptionPrefix: "MongoDB or Atlas operation pending approval",
  });

  return {
    tools: availableTools,
    systemPrompt: buildSystemPrompt(allowWriteOperations, {
      ...config.systemPrompt,
      dataAccess,
    }),
    skills: ["skills"],
    middleware: [
      createInputRefusalMiddleware({ mode: config.inputGuard.mode }),
      stampResumeClientUserMiddleware,
      stripToolEchoMiddleware,
      redactSecretsMiddleware,
      clusterAllowlistMiddleware(dataAccess),
      mutativeToolReview,
      approveAggregateWritesMiddleware,
      // After approval, so it checks the arguments a reviewer edited.
      databaseAllowlistMiddleware(dataAccess.databaseNames),
      recoverToolErrorsMiddleware,
    ] as AgentMiddleware[],
  };
}
