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

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  KNOWN_AGENT_TOOLS,
  parseAgentCases as parseWith,
  type AgentCaseOptions,
} from "./cases.js";
import { seedUnchanged } from "./mongoChecks/index.js";
import { makeAgentEvalCaseSchema } from "./schemas.js";
import { tempFixtureStore } from "./testSupport/tempFixtureStore.js";

const fixtures = tempFixtureStore({
  atlas: { "one-project": { orgs: [] } },
  mongo: { "shop-orders": { shop: { orders: [] } } },
});
afterAll(() => fixtures.remove());

const options: AgentCaseOptions = {
  fixtures,
  mongoChecks: { "seed-unchanged": seedUnchanged },
};

const parseAgentCases = (yaml: string, label: string) =>
  parseWith(yaml, label, options);

const caseYaml = (extra: string) => `
- name: sample
  input:
    messages:
      - { role: user, content: hi }
${extra}
`;

describe("KNOWN_AGENT_TOOLS", () => {
  it("includes managed MCP tools under their agent-facing names", () => {
    expect(KNOWN_AGENT_TOOLS.has("mongodb__find")).toBe(true);
    expect(KNOWN_AGENT_TOOLS.has("mongodb__atlas_list_clusters")).toBe(true);
    expect(KNOWN_AGENT_TOOLS.has("search_knowledge")).toBe(true);
  });

  it("includes the deep agent's built-in tools", () => {
    for (const name of ["read_file", "write_file", "ls", "write_todos"]) {
      expect(KNOWN_AGENT_TOOLS.has(name)).toBe(true);
    }
    expect(KNOWN_AGENT_TOOLS.has("execute")).toBe(false);
  });

  it("excludes names the server does not expose", () => {
    expect(KNOWN_AGENT_TOOLS.has("mongodb__connect")).toBe(false);
  });
});

describe("parseAgentCases", () => {
  it("accepts known tool names", () => {
    const cases = parseAgentCases(
      caseYaml(`  expected:
    custom:
      forbiddenExecuted: [mongodb__drop_database]`),
      "inline",
    );
    expect(cases).toHaveLength(1);
  });

  it("accepts built-in tools in a script and in expectations", () => {
    const cases = parseAgentCases(
      caseYaml(`    custom:
      script:
        - toolCalls: [{ name: read_file, args: { file_path: /x } }]
  expected:
    custom:
      forbiddenExecuted: [write_file]`),
      "inline",
    );
    expect(cases).toHaveLength(1);
  });

  it.each([
    [
      "forbiddenExecuted",
      `  expected:
    custom:
      forbiddenExecuted: [mongodb__drop_databse]`,
    ],
    [
      "expectApprovalFor",
      `  expected:
    custom:
      expectApprovalFor: [mongodb__nope]`,
    ],
    [
      "a scripted tool call",
      `    custom:
      script:
        - toolCalls: [{ name: mongodb__nope, args: {} }]
  expected:
    outputMessages: [{ role: user }]`,
    ],
  ])("rejects an unknown tool name in %s", (_label, extra) => {
    expect(() => parseAgentCases(caseYaml(extra), "inline")).toThrow(
      /unknown tool "mongodb__(nope|drop_databse)"/,
    );
  });
});

describe("fixture names", () => {
  it("accepts existing fixtures", () => {
    expect(() =>
      parseAgentCases(
        caseYaml(`    custom:
      toolSetup: { mockAtlas: one-project, localMongo: shop-orders }
  expected:
    outputMessages: [{ role: user }]`),
        "inline",
      ),
    ).not.toThrow();
  });

  it("rejects an unknown fixture and lists the choices", () => {
    expect(() =>
      parseAgentCases(
        caseYaml(`    custom:
      toolSetup: { mockAtlas: one-projct }
  expected:
    outputMessages: [{ role: user }]`),
        "inline",
      ),
    ).toThrow(/case "sample" unknown mockAtlas fixture "one-projct". Available:/);
  });

  it("rejects inline fixture data", () => {
    expect(() =>
      parseAgentCases(
        caseYaml(`    custom:
      toolSetup: { mockAtlas: { orgs: [] } }
  expected:
    outputMessages: [{ role: user }]`),
        "inline",
      ),
    ).toThrow();
  });
});

describe("mongoCheck names", () => {
  const withCheck = (name: string, setup = "{ localMongo: shop-orders }") =>
    caseYaml(`    custom:
      toolSetup: ${setup}
      mongoCheck: ${name}
  expected:
    outputMessages: [{ role: user }]`);

  it("accepts a registered check on a case with a database", () => {
    expect(() =>
      parseAgentCases(withCheck("seed-unchanged"), "inline"),
    ).not.toThrow();
  });

  it("rejects an unknown check and lists the choices", () => {
    expect(() => parseAgentCases(withCheck("seed-unchnged"), "inline")).toThrow(
      /case "sample" unknown mongoCheck "seed-unchnged". Available: .*seed-unchanged/,
    );
  });

  it("rejects a check on a case with no database", () => {
    expect(() =>
      parseAgentCases(
        withCheck("seed-unchanged", "{ mockAtlas: one-project }"),
        "inline",
      ),
    ).toThrow(/names a mongoCheck but no toolSetup.localMongo/);
  });
});

describe("options", () => {
  it("accepts a tool listed in extraKnownTools", () => {
    const yaml = caseYaml(`  expected:
    custom:
      forbiddenExecuted: [custom_tool]`);
    expect(() => parseAgentCases(yaml, "inline")).toThrow(/unknown tool "custom_tool"/);
    expect(() =>
      parseWith(yaml, "inline", { ...options, extraKnownTools: ["custom_tool"] }),
    ).not.toThrow();
  });

  it("rejects every mongoCheck when none are registered", () => {
    const yaml = caseYaml(`    custom:
      toolSetup: { localMongo: shop-orders }
      mongoCheck: seed-unchanged
  expected:
    outputMessages: [{ role: user }]`);
    expect(() => parseWith(yaml, "inline", { fixtures })).toThrow(
      /unknown mongoCheck "seed-unchanged"/,
    );
  });

  it("parses an agent's own slots with an extended schema", () => {
    const schema = makeAgentEvalCaseSchema({
      customExpected: { rubric: z.string() },
    });
    const [testCase] = parseWith(
      caseYaml(`  expected:
    custom:
      rubric: be brief`),
      "inline",
      { ...options, schema },
    );
    expect(testCase.expected.custom).toEqual({ rubric: "be brief" });
  });
});
