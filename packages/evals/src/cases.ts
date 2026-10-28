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

import { assertFixtureExists, type FixtureField } from "./fixtures.js";
import { agentToolName, MANAGED_MCP_TOOLS } from "./mcp/managedTools.js";
import {
  AgentEvalCaseSchema,
  type CustomExpected,
  type CustomInput,
} from "./schemas.js";

type AgentEvalCase = ReturnType<
  typeof getConversationEvalCasesFromYaml<
    ReturnType<typeof AgentEvalCaseSchema.parse>
  >
>[number];

/** Names the agent can see: the `mongodb__` tools plus the knowledge tools. */
export const KNOWN_AGENT_TOOLS: ReadonlySet<string> = new Set([
  ...MANAGED_MCP_TOOLS.map(agentToolName),
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

function assertFixturesExist(testCase: AgentEvalCase, label: string): void {
  const input = testCase.input.custom as CustomInput | undefined;
  for (const [field, name] of Object.entries(input?.toolSetup ?? {})) {
    try {
      assertFixtureExists(field as FixtureField, name);
    } catch (error) {
      throw new Error(
        `${label}: case "${testCase.name ?? "(unnamed)"}" ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Parses a YAML dataset and rejects tool names and fixture names that do not
 * exist. A typo in
 * `forbiddenExecuted` would otherwise pass for ever, because a tool that is
 * never called is never executed.
 */
export function parseAgentCases(yaml: string, label: string): AgentEvalCase[] {
  const cases = getConversationEvalCasesFromYaml({
    yaml,
    schema: AgentEvalCaseSchema,
  });
  for (const testCase of cases) {
    assertFixturesExist(testCase, label);
    for (const { where, name } of toolNamesIn(testCase)) {
      if (!KNOWN_AGENT_TOOLS.has(name)) {
        throw new Error(
          `${label}: case "${testCase.name ?? "(unnamed)"}" names unknown tool "${name}" in ${where}`,
        );
      }
    }
  }
  return cases;
}

export function loadAgentCasesFromFile(file: string): AgentEvalCase[] {
  return parseAgentCases(fs.readFileSync(file, "utf8"), file);
}
