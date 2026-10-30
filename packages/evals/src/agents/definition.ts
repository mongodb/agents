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

import type { StructuredToolInterface } from "@langchain/core/tools";
import type { DefaultDataConfig } from "@repo/agent-engine-core";
import type { AgentMiddleware } from "langchain";

export interface BuildAgentOptionsArgs {
  /** Every tool the runtime discovered, before the agent's tool policy. */
  readonly tools: readonly StructuredToolInterface[];
  readonly allowWrites: boolean;
  /** Replaces the config's `systemPrompt.defaultData` for this case. */
  readonly defaultData?: DefaultDataConfig;
  /** Appended to the config's `systemPrompt.customInstructions`. */
  readonly extraInstructions?: string;
}

export interface BuiltAgentOptions {
  readonly tools: StructuredToolInterface[];
  readonly systemPrompt: string;
  readonly skills: string[];
  readonly middleware: AgentMiddleware[];
}

/**
 * Everything the harness needs to run one of the repo's agents. The options
 * come from the same builder `main.ts` calls, so a change to the agent's
 * prompt, tools, or middleware shows up in the evals.
 */
export interface AgentDefinition {
  readonly name: string;
  /** Holds `skills/`. Relative skill paths resolve against it. */
  readonly agentDir: string;
  readonly inputGuardMode: "enforce" | "monitor" | "off";
  /** False when the agent never exposes write tools. */
  readonly supportsWrites: boolean;
  buildOptions(args: BuildAgentOptionsArgs): BuiltAgentOptions;
}
