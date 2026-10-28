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


import { createMongoDbAssistantEvalCli } from "mongodb-assistant-eval/cli";

import { atlasExplorerAgent } from "./agents/atlasExplorer.js";
import { atlasQueryInsightsAgent } from "./agents/atlasQueryInsights.js";
import type { ModelConfig } from "./models.js";
import {
  SMOKE_DATASET,
  SMOKE_SCORER,
  SMOKE_VALIDATOR,
  nonEmptyAnswerScorer,
  smokeDataset,
  smokeValidator,
} from "./smoke/smokeSuite.js";
import { makeAgentTask } from "./task.js";
import { staticToolProvider } from "./tools/staticToolProvider.js";

export const BRAINTRUST_PROJECT = "mongodb-agents";

/** `--model` names. `scripted` needs no key. The rest call a real provider. */
export const evalModels: Record<string, { config: ModelConfig }> = {
  scripted: { config: { kind: "scripted" } },
  "gpt-4.1-mini": {
    config: { kind: "llm", provider: "openai", model: "gpt-4.1-mini" },
  },
};

/**
 * Builds the `evaluation` CLI for both agents. Suites register their
 * datasets, scorers and validators here. Today only the smoke suite exists.
 */
export function createEvalCli() {
  const toolProvider = staticToolProvider([]);
  return createMongoDbAssistantEvalCli({
    projectName: BRAINTRUST_PROJECT,
    datasets: { [SMOKE_DATASET]: smokeDataset },
    models: evalModels,
    tasks: {
      explorer: makeAgentTask(atlasExplorerAgent, { toolProvider }),
      "query-insights": makeAgentTask(atlasQueryInsightsAgent, {
        toolProvider,
      }),
    },
    scorers: { [SMOKE_SCORER]: nonEmptyAnswerScorer },
    validators: { [SMOKE_VALIDATOR]: smokeValidator },
  });
}
