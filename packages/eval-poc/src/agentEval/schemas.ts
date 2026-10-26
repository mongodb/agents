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
import { makeConversationEvalCaseSchema } from "mongodb-assistant-eval/schema";

const ScriptedTurnSchema = z.object({
  text: z.string().optional(),
  toolCalls: z
    .array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) }))
    .optional(),
});

/** Agent-specific input slots carried in the library's `input.custom`. */
export const CustomInputSchema = z.object({
  /** Which tools the agent gets. `mock-*` ids are fresh state per case. */
  toolSource: z.enum(["mock-atlas", "mock-advisor", "mcp"]),
  /** Deterministic model turns; only read by the `scripted` model entry. */
  script: z.array(ScriptedTurnSchema).optional(),
  /** Write-mode agent (HITL approval for mutating tools). */
  allowWrites: z.boolean().optional(),
  /** How the harness answers an approval request. */
  approval: z.enum(["approve", "reject"]).optional(),
  /** Fixture for `mock-advisor`: the get_performance_advisor tool output. */
  advisorOutput: z.string().optional(),
  /** Prompt hint (cluster the agent should use). */
  defaultData: z
    .object({ projectId: z.string().optional(), clusterName: z.string().optional() })
    .optional(),
});

/** Agent-specific expectations carried in `expected.custom`. */
export const CustomExpectedSchema = z.object({
  finalTier: z.string().optional(),
  /** Tools the agent must not be able to execute. */
  forbiddenExecuted: z.array(z.string()).optional(),
  expectApprovalFor: z.array(z.string()).optional(),
  /** Strings that must appear nowhere in the conversation the model saw. */
  forbiddenText: z.array(z.string()).optional(),
  /** Regexes the final answer must match (cheap stand-in for an LLM judge). */
  answerMatches: z.array(z.string()).optional(),
});

export type CustomInput = z.infer<typeof CustomInputSchema>;
export type CustomExpected = z.infer<typeof CustomExpectedSchema>;

export const AgentEvalCaseSchema = makeConversationEvalCaseSchema({
  customInputSchema: CustomInputSchema,
  customExpectedSchema: CustomExpectedSchema,
});
