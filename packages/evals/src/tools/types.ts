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

export interface CaseToolsRequest {
  /** Whether the case runs the agent with write tools exposed. */
  readonly allowWrites: boolean;
  /**
   * Provider-specific fixture from `input.custom.toolSetup`, for example
   * documents to seed. The provider validates it.
   */
  readonly setup?: Readonly<Record<string, unknown>>;
}

/** The tools one case runs against, and the state they leave behind. */
export interface CaseTools {
  /** Every tool the runtime would discover, before the agent's tool policy. */
  readonly tools: StructuredToolInterface[];
  /** End state for scorers. Called once, after the agent finishes. */
  state(): Promise<unknown> | unknown;
  /** Releases anything `forCase` started. Always called, even on failure. */
  dispose(): Promise<void>;
}

/**
 * Where a case's tools come from. Cases run concurrently, so `forCase` must
 * return state that no other case can see.
 */
export interface ToolProvider {
  /** Runs once before any case. */
  start?(): Promise<void>;
  /** Runs once after the last case, even if some failed. */
  stop?(): Promise<void>;
  forCase(request: CaseToolsRequest): Promise<CaseTools>;
}
