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

import path from "node:path";
import fs from "node:fs";
import { createMongoDbAssistantEvalCli } from "mongodb-assistant-eval/cli";
import { getConversationEvalCasesFromYaml } from "mongodb-assistant-eval/datasets";
import { makeValidateMinimums } from "mongodb-assistant-eval/validators";
import { AgentEvalCaseSchema } from "./schemas.js";
import { scorers } from "./scorers.js";
import { makeAgentTask, type ModelConfig } from "./task.js";

const dir = path.join(import.meta.dirname, "datasets");
const yamlDataset = (file: string, description: string) => ({
  description,
  getCases: async () =>
    getConversationEvalCasesFromYaml({
      yaml: fs.readFileSync(path.join(dir, file), "utf8"),
      schema: AgentEvalCaseSchema,
    }) as never[],
});

export function buildCli() {
  return createMongoDbAssistantEvalCli({
    projectName: "agents-evals-poc",
    datasets: {
      "explorer-smoke": yamlDataset("explorer-smoke.yml", "Atlas Explorer smoke"),
      "qi-smoke": yamlDataset("qi-smoke.yml", "Atlas Query Insights smoke"),
    },
    models: {
      scripted: { description: "Deterministic, no key", config: { kind: "scripted" } },
      "gpt-6-luna": {
        description: "Same model the agents run in production",
        config: { kind: "llm", provider: "openai", model: "gpt-6-luna" },
      },
    } satisfies Record<string, { description: string; config: ModelConfig }>,
    tasks: {
      explorer: makeAgentTask("atlas-explorer"),
      "query-insights": makeAgentTask("atlas-query-insights"),
    },
    scorers,
    // A threshold on a score a dataset never emits counts as "missing" and
    // fails, so keep one validator per task.
    validators: {
      "smoke-explorer": makeValidateMinimums({
        scoreThresholds: {
          ToolCallCoverage: 1,
          EndStateTier: 1,
          NoForbiddenExecuted: 1,
          ApprovalRequested: 1,
          NoForbiddenText: 1,
          AnswerMatches: 1,
        },
      }),
      "smoke-qi": makeValidateMinimums({
        scoreThresholds: { ToolCallCoverage: 1, AnswerMatches: 1 },
      }),
    },
  } as never);
}
