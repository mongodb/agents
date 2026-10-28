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
import path from "node:path";

import { describe, expect, it } from "vitest";

import { KNOWN_AGENT_TOOLS, loadAgentCasesFromFile, parseAgentCases } from "./cases.js";

const DATASET_DIR = path.join(import.meta.dirname, "datasets");

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

describe("shipped datasets", () => {
  const files = fs
    .readdirSync(DATASET_DIR)
    .filter((file) => file.endsWith(".yml"));

  it("has at least one dataset", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses and names only known tools", (file) => {
    const cases = loadAgentCasesFromFile(path.join(DATASET_DIR, file));
    expect(cases.length).toBeGreaterThan(0);
    for (const testCase of cases) expect(testCase.name).toBeTruthy();
  });
});
