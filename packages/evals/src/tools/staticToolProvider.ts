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

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { z } from "zod";

import type { CaseTools, CaseToolsRequest, ToolProvider } from "./types.js";

export interface StaticToolSpec {
  readonly name: string;
  readonly description?: string;
  readonly schema: z.ZodObject<z.ZodRawShape>;
  /** Result the model sees. A thrown error becomes a tool error. */
  readonly result: (args: Record<string, unknown>) => string | Promise<string>;
}

/**
 * Canned tools for unit tests and for cases that only need fixed tool
 * output. A fresh set is built for every case.
 */
export function staticToolProvider(
  specs: readonly StaticToolSpec[],
  state: () => unknown = () => ({}),
): ToolProvider {
  return {
    async forCase(_request: CaseToolsRequest): Promise<CaseTools> {
      return {
        tools: specs.map(
          (spec) =>
            tool(async (args: Record<string, unknown>) => spec.result(args), {
              name: spec.name,
              description: spec.description ?? spec.name,
              schema: spec.schema as never,
            }) as unknown as StructuredToolInterface,
        ),
        state,
        dispose: async () => {},
      };
    },
  };
}
