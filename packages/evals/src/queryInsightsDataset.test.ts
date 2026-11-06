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
import { parse } from "yaml";

import { loadAgentCasesFromFile } from "./cases.js";
import { AtlasFixtureSchema } from "./atlas/fixtures.js";

const FIXTURE_DIR = path.join(import.meta.dirname, "..", "fixtures", "atlas");
const DATASET = path.join(import.meta.dirname, "..", "datasets", "query-insights.yml");
const USER_QUERIES = path.join(import.meta.dirname, "..", "datasets", "query-insights-realistic-user-queries.yml");
const INJECTION = path.join(import.meta.dirname, "..", "datasets", "query-insights-injection.yml");

interface CaseCustom {
  toolSetup: { mockAtlas: string };
}

interface CustomExpectedCase {
  queryInsights?: { reference: string };
}

describe("query-insights dataset", () => {
  const cases = loadAgentCasesFromFile(DATASET);

  it("has one case per ported source or combined set, each reading its own valid seed", () => {
    expect(cases).toHaveLength(33);
    for (const testCase of cases) {
      const { toolSetup } = testCase.input.custom as CaseCustom;
      const seedName = toolSetup.mockAtlas;
      expect(seedName, testCase.name).toBe(testCase.name);
      const seedFile = path.join(FIXTURE_DIR, `${seedName}.yml`);
      expect(fs.existsSync(seedFile), seedName).toBe(true);
      expect(() => AtlasFixtureSchema.parse(parse(fs.readFileSync(seedFile, "utf8")))).not.toThrow();
    }
  });

  it("keeps lifetime totals out of every reference", () => {
    for (const testCase of cases) {
      const { queryInsights } = testCase.expected.custom as CustomExpectedCase;
      const reference = queryInsights?.reference;
      expect(reference, testCase.name).toBeDefined();
      const withoutListNumbers = reference!.replace(/^\d+\. /gm, "");
      expect(withoutListNumbers, testCase.name).not.toMatch(/\d/);
    }
  });
});

describe("query-insights realistic user queries dataset", () => {
  const cases = loadAgentCasesFromFile(USER_QUERIES);

  it("reads the seed of a ported case, with a message of its own", () => {
    expect(cases).toHaveLength(7);
    for (const testCase of cases) {
      const { toolSetup } = testCase.input.custom as CaseCustom;
      expect(fs.existsSync(path.join(FIXTURE_DIR, `${toolSetup.mockAtlas}.yml`)), testCase.name).toBe(true);
      expect(testCase.tags, testCase.name).toContain("user-query");
    }
  });
});

describe("query-insights injection dataset", () => {
  const cases = loadAgentCasesFromFile(INJECTION);

  it("has its own seeds for slow-log steering, and reads ported seeds for user cases", () => {
    expect(cases).toHaveLength(6);
    for (const testCase of cases) {
      const { toolSetup } = testCase.input.custom as CaseCustom;
      expect(fs.existsSync(path.join(FIXTURE_DIR, `${toolSetup.mockAtlas}.yml`)), testCase.name).toBe(true);
      expect(testCase.tags, testCase.name).toContain("injection");
    }
  });
});
