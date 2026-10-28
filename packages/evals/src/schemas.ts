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

import { makeConversationEvalCaseSchema } from "mongodb-assistant-eval/schema";
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
  /**
   * Names of the fixtures in `fixtures/` the tool provider starts from.
   * Names only: fixture data stays out of the dataset rows Braintrust logs.
   * The task output still carries the end state, so fixtures must be synthetic.
   */
  toolSetup: z
    .object({
      mockAtlas: z.string().optional(),
      localMongo: z.string().optional(),
    })
    .strict()
    .optional(),
});

export type CustomInput = z.infer<typeof CustomInputSchema>;

const JsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Agent-specific expectations, carried in the library's `expected.custom`. */
export const CustomExpectedSchema = z.object({
  /** Tools that must not have run, whether hidden, refused, or rejected. */
  forbiddenExecuted: z.array(z.string()).optional(),
  /** Tools the agent must have paused on for human approval. */
  expectApprovalFor: z.array(z.string()).optional(),
  /** Strings that must appear nowhere in the conversation. */
  forbiddenText: z.array(z.string()).optional(),
  /** Regular expressions the final answer must match, ignoring case. */
  answerMatches: z.array(z.string()).optional(),
  /**
   * Checks on the tool provider's end state. `path` is dot-separated, with
   * array indexes as numbers, for example `atlas.projects.0.clusters.0.paused`.
   */
  state: z
    .array(z.object({ path: z.string(), equals: JsonScalarSchema }))
    .optional(),
});

export type CustomExpected = z.infer<typeof CustomExpectedSchema>;

export const AgentEvalCaseSchema = makeConversationEvalCaseSchema({
  customInputSchema: CustomInputSchema,
  customExpectedSchema: CustomExpectedSchema,
});
