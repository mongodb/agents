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

import { z } from "zod";

const ScriptedTurnSchema = z.object({
  text: z.string().optional(),
  toolCalls: z
    .array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) }))
    .optional(),
});

/** Agent-specific input slots, carried in the library's `input.custom`. */
export const CustomInputSchema = z.object({
  /** Deterministic model turns. Only the `scripted` model reads them. */
  script: z.array(ScriptedTurnSchema).optional(),
  /** Run the agent with write tools behind human approval. Default false. */
  allowWrites: z.boolean().optional(),
  /** How the harness answers an approval request. Default `approve`. */
  approval: z.enum(["approve", "reject"]).optional(),
  /** Replaces the agent config's prompt defaults for this case. */
  defaultData: z
    .object({
      projectId: z.string().optional(),
      clusterName: z.string().optional(),
      databaseName: z.string().optional(),
      collectionName: z.string().optional(),
    })
    .optional(),
  /** Fixture for the tool provider, for example seed documents. */
  toolSetup: z.record(z.string(), z.unknown()).optional(),
});

export type CustomInput = z.infer<typeof CustomInputSchema>;
