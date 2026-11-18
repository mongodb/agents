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
import {
  makeFactuality,
  type JudgeModelConfig,
} from "mongodb-assistant-eval/scorers";
import {
  makeValidateMinimums,
  type Validator,
} from "mongodb-assistant-eval/validators";

import type { AgentDefinition } from "./agents/definition.js";
import { loadAgentCasesFromFile, type AgentCaseOptions } from "./cases.js";
import type { FixtureStore } from "./fixtures.js";
import { judgeModelConfig } from "./judge.js";
import type { ModelConfig } from "./models.js";
import type { MongoCheck } from "./mongoChecks/index.js";
import type { AnyAgentEvalCaseSchema } from "./schemas.js";
import { scorers } from "./scorers.js";
import { makeAgentTask } from "./task.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";
import type { ToolProvider } from "./tools/types.js";
import { withNamedFixtures } from "./tools/withNamedFixtures.js";

/** A YAML dataset on disk, or cases from anywhere else. */
export type AgentEvalDataset =
  | { readonly description: string; readonly file: string }
  | {
      readonly description: string;
      readonly getCases: () => Promise<unknown[]>;
    };

export interface AgentEvalScorer {
  /** Any `mongodb-assistant-eval` scorer over the agent task's output. */
  readonly scorer: (args: never) => unknown;
  readonly description?: string;
}

export interface AgentEvalCliOptions {
  /** The Braintrust project the experiments go to. */
  readonly projectName: string;
  /** One `--task` per agent. */
  readonly agents: Readonly<Record<string, AgentDefinition>>;
  readonly datasets: Readonly<Record<string, AgentEvalDataset>>;
  /** Real models by `--model` name. `scripted` is always there. */
  readonly models?: Readonly<
    Record<string, ModelConfig & { readonly description?: string }>
  >;
  /** Where the fixtures that cases name live. */
  readonly fixtures: FixtureStore;
  /** Checks a case can name in `input.custom.mongoCheck`. Default none. */
  readonly mongoChecks?: Readonly<Record<string, MongoCheck>>;
  /** Tool names the agents have beyond the shared ones. */
  readonly extraKnownTools?: Iterable<string>;
  /** For agents with their own case slots. See `makeAgentEvalCaseSchema`. */
  readonly caseSchema?: AnyAgentEvalCaseSchema;
  /**
   * `--validate` choices, each a minimum per score. A threshold on a score
   * the dataset never emits counts as missing and fails.
   */
  readonly validators?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Added to the shared scorers and `Factuality`. Given the judge. */
  readonly extraScorers?: (
    judge: JudgeModelConfig,
  ) => Readonly<Record<string, AgentEvalScorer>>;
  /** Defaults to the local servers. Tests pass stubs. */
  readonly toolProvider?: ToolProvider;
  /** Defaults to `judgeModelConfig()`. Tests pass a stub. */
  readonly judge?: JudgeModelConfig;
}

/**
 * An eval CLI for a suite of agents:
 *
 *   eval evaluation run --task <agent> --dataset <name> \
 *     --model scripted --validate <validator>
 *
 * `scripted` replays each case's `input.custom.script`, so it needs no model
 * key. Call `parseAsync()` on the result.
 */
export function createAgentEvalCli({
  projectName,
  agents,
  datasets,
  models = {},
  fixtures,
  mongoChecks = {},
  extraKnownTools,
  caseSchema,
  validators = {},
  extraScorers,
  toolProvider: baseProvider = createLocalToolProvider(),
  judge = judgeModelConfig(),
}: AgentEvalCliOptions) {
  const toolProvider = withNamedFixtures(baseProvider, fixtures);
  const caseOptions: AgentCaseOptions = {
    fixtures,
    mongoChecks,
    extraKnownTools,
    schema: caseSchema as AgentCaseOptions["schema"],
  };
  return createMongoDbAssistantEvalCli({
    projectName,
    datasets: Object.fromEntries(
      Object.entries(datasets).map(([name, dataset]) => [
        name,
        "file" in dataset
          ? {
              description: dataset.description,
              getCases: async () =>
                loadAgentCasesFromFile(dataset.file, caseOptions),
            }
          : dataset,
      ]),
    ),
    models: {
      scripted: {
        description: "Replays input.custom.script. No key needed.",
        config: { kind: "scripted" } satisfies ModelConfig,
      },
      ...Object.fromEntries(
        Object.entries(models).map(([name, { description, ...config }]) => [
          name,
          { description, config },
        ]),
      ),
    },
    tasks: Object.fromEntries(
      Object.entries(agents).map(([name, agent]) => [
        name,
        makeAgentTask(agent, { toolProvider, mongoChecks }),
      ]),
    ),
    scorers: {
      ...scorers,
      Factuality: {
        scorer: makeFactuality(judge),
        description:
          "LLM judge: does the answer agree with the case's referenceAnswer",
      },
      ...extraScorers?.(judge),
    },
    validators: Object.fromEntries(
      Object.entries(validators).map(([name, scoreThresholds]) => [
        name,
        makeValidateMinimums({ scoreThresholds: { ...scoreThresholds } }),
      ]),
    ) as Record<string, Validator>,
  } as never);
}
