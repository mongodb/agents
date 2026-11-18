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

import fs from "node:fs";

import { getConversationEvalCasesFromYaml } from "mongodb-assistant-eval/datasets";
import type { z } from "zod";

import type { FixtureField, FixtureStore } from "./fixtures.js";
import { agentToolName, MANAGED_MCP_TOOLS } from "./mcp/managedTools.js";
import { assertMongoCheckExists, type MongoCheck } from "./mongoChecks/index.js";
import {
  AgentEvalCaseSchema,
  type AnyAgentEvalCaseSchema,
  type CustomExpected,
  type CustomInput,
} from "./schemas.js";

export type AgentEvalCase = z.infer<typeof AgentEvalCaseSchema>;

export interface AgentCaseOptions<
  Schema extends AnyAgentEvalCaseSchema = typeof AgentEvalCaseSchema,
> {
  /** Where the fixtures that cases name live. */
  readonly fixtures: FixtureStore;
  /** Checks a case can name in `input.custom.mongoCheck`. Default none. */
  readonly mongoChecks?: Readonly<Record<string, MongoCheck>>;
  /** Tool names the agent has beyond {@link KNOWN_AGENT_TOOLS}. */
  readonly extraKnownTools?: Iterable<string>;
  /** Defaults to {@link AgentEvalCaseSchema}. */
  readonly schema?: Schema;
}

/**
 * Tools the deep agent always has: its virtual filesystem (skills are read
 * through it), planning, and sub-agent delegation. `execute` is left out
 * because it needs a sandbox backend the agents do not configure.
 */
export const DEEP_AGENT_BUILT_IN_TOOLS: readonly string[] = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "delete",
  "glob",
  "grep",
  "write_todos",
  "task",
];

/**
 * Names every agent can see: the `mongodb__` tools, the knowledge tools, and
 * the deep agent's built-ins. Pass others as `extraKnownTools`.
 */
export const KNOWN_AGENT_TOOLS: ReadonlySet<string> = new Set([
  ...MANAGED_MCP_TOOLS.map(agentToolName),
  ...DEEP_AGENT_BUILT_IN_TOOLS,
  "search_knowledge",
  "list_knowledge_sources",
]);

function toolNamesIn(testCase: AgentEvalCase): { where: string; name: string }[] {
  const found: { where: string; name: string }[] = [];
  const input = testCase.input.custom as CustomInput | undefined;
  (input?.script ?? []).forEach((turn, i) => {
    for (const call of turn.toolCalls ?? []) {
      found.push({ where: `input.custom.script[${i}]`, name: call.name });
    }
  });
  const expected = testCase.expected;
  const custom = expected.custom as CustomExpected | undefined;
  for (const name of custom?.forbiddenExecuted ?? []) {
    found.push({ where: "expected.custom.forbiddenExecuted", name });
  }
  for (const name of custom?.expectApprovalFor ?? []) {
    found.push({ where: "expected.custom.expectApprovalFor", name });
  }
  for (const message of expected.outputMessages ?? []) {
    if (message.role !== "assistant-tool") continue;
    for (const call of message.toolCalls) {
      found.push({ where: "expected.outputMessages", name: call.name });
    }
  }
  return found;
}

function assertFixturesExist(
  testCase: AgentEvalCase,
  label: string,
  fixtures: FixtureStore,
): void {
  const input = testCase.input.custom as CustomInput | undefined;
  for (const [field, name] of Object.entries(input?.toolSetup ?? {})) {
    try {
      fixtures.assertExists(field as FixtureField, name);
    } catch (error) {
      throw new Error(
        `${label}: case "${testCase.name ?? "(unnamed)"}" ${(error as Error).message}`,
      );
    }
  }
}

function assertMongoCheckValid(
  testCase: AgentEvalCase,
  label: string,
  checks: Readonly<Record<string, MongoCheck>>,
): void {
  const input = testCase.input.custom as CustomInput | undefined;
  if (input?.mongoCheck === undefined) return;
  const where = `${label}: case "${testCase.name ?? "(unnamed)"}"`;
  if (!input.toolSetup?.localMongo) {
    throw new Error(`${where} names a mongoCheck but no toolSetup.localMongo`);
  }
  try {
    assertMongoCheckExists(input.mongoCheck, checks);
  } catch (error) {
    throw new Error(`${where} ${(error as Error).message}`);
  }
}

/**
 * Parses a YAML dataset and rejects tool names, fixture names and Mongo check
 * names that do not exist. A typo in
 * `forbiddenExecuted` would otherwise pass for ever, because a tool that is
 * never called is never executed.
 */
export function parseAgentCases<
  Schema extends AnyAgentEvalCaseSchema = typeof AgentEvalCaseSchema,
>(
  yaml: string,
  label: string,
  {
    fixtures,
    mongoChecks = {},
    extraKnownTools = [],
    schema,
  }: AgentCaseOptions<Schema>,
): z.infer<Schema>[] {
  const knownTools = new Set([...KNOWN_AGENT_TOOLS, ...extraKnownTools]);
  const cases = getConversationEvalCasesFromYaml({
    yaml,
    schema: (schema ?? AgentEvalCaseSchema) as unknown as z.ZodType<z.infer<Schema>>,
  });
  for (const testCase of cases) {
    assertFixturesExist(testCase, label, fixtures);
    assertMongoCheckValid(testCase, label, mongoChecks);
    for (const { where, name } of toolNamesIn(testCase)) {
      if (!knownTools.has(name)) {
        throw new Error(
          `${label}: case "${testCase.name ?? "(unnamed)"}" names unknown tool "${name}" in ${where}`,
        );
      }
    }
  }
  return cases;
}

export function loadAgentCasesFromFile<
  Schema extends AnyAgentEvalCaseSchema = typeof AgentEvalCaseSchema,
>(file: string, options: AgentCaseOptions<Schema>): z.infer<Schema>[] {
  return parseAgentCases(fs.readFileSync(file, "utf8"), file, options);
}
