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

import type { DefaultDataConfig } from "./defaultData.js";

/** The per-agent `llm` block in `config.ts`. */
export interface LlmConfig {
  readonly provider: string;
  readonly model: string;
}

/** The per-agent `systemPrompt` block in `config.ts`. */
export interface SystemPromptConfig {
  readonly name: string;
  readonly customInstructions: string;
  readonly defaultData: DefaultDataConfig;
}
