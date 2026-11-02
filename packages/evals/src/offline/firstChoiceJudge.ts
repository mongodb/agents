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

import type { JudgeModelConfig } from "mongodb-assistant-eval/scorers";
import { vi } from "vitest";

interface ChoiceTool {
  function: { parameters: { properties: { choice: { enum: string[] } } } };
}

/**
 * A judge for offline runs. Each call answers with the first choice its
 * schema allows, so the judge scorers run without a network call.
 */
export function firstChoiceJudge(): JudgeModelConfig {
  const create = vi.fn(async (request: { tools: ChoiceTool[] }) => {
    const [choice] = request.tools[0].function.parameters.properties.choice.enum;
    return {
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "select_choice",
                  arguments: JSON.stringify({ rationale: "stub", choice }),
                },
              },
            ],
          },
        },
      ],
    };
  });
  return {
    modelId: "judge-model",
    client: { chat: { completions: { create } } },
    braintrustProxy: { apiKey: "k", endpoint: "e" },
  } as unknown as JudgeModelConfig;
}
