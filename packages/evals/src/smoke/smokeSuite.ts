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


import type { EvalDataset, EvalScorerEntry } from "mongodb-assistant-eval/cli";
import { makeValidateMinimums } from "mongodb-assistant-eval/validators";

import type { AgentTaskInput, AgentTaskOutput } from "../task.js";

export const SMOKE_DATASET = "smoke";
export const SMOKE_SCORER = "NonEmptyAnswer";
export const SMOKE_VALIDATOR = "smoke";

/**
 * One case that needs no tools. It proves the CI plumbing: the agent builds,
 * the model answers, scores upload to Braintrust and the validator gates the
 * exit code. A real model ignores the script. The `scripted` model replays it.
 */
export const smokeDataset: EvalDataset<AgentTaskInput, string> = {
  description: "One tool-free question, for checking CI wiring",
  async getCases() {
    return [
      {
        name: "smoke-hello",
        input: {
          messages: [
            {
              role: "user",
              content: "In one sentence, what is MongoDB?",
            },
          ],
          custom: {
            script: [{ text: "MongoDB is a document database." }],
          },
        },
        expected: "A one-sentence description of MongoDB",
        metadata: {},
      },
    ];
  },
};

export const nonEmptyAnswerScorer: EvalScorerEntry<
  AgentTaskInput,
  AgentTaskOutput,
  string
> = {
  description: "1 when the agent returned a non-empty final answer",
  scorer: ({ output }) => ({
    name: SMOKE_SCORER,
    score: output.assistantMessageContent.trim().length > 0 ? 1 : 0,
  }),
};

export const smokeValidator = makeValidateMinimums({
  scoreThresholds: { [SMOKE_SCORER]: 1 },
});
