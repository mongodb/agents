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

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";

export interface ExecutedToolCall {
  readonly name: string;
  readonly args: unknown;
}

/**
 * Records tools that actually started. A call the model requested but a
 * middleware refused, or a human rejected, never reaches a tool, so it is
 * not recorded. Scorers use this to check what the agent could really do.
 */
export class ExecutionRecorder extends BaseCallbackHandler {
  name = "eval-execution-recorder";
  awaitHandlers = true;
  readonly calls: ExecutedToolCall[] = [];

  handleToolStart(
    tool: { name?: string; id?: string[] },
    input: string,
    _runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    let args: unknown = input;
    try {
      args = JSON.parse(input);
    } catch {
      // Keep the raw string.
    }
    this.calls.push({ name: runName ?? tool.name ?? "unknown", args });
  }
}
