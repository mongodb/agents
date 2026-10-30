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

import path from "node:path";

import { describe, expect, it } from "vitest";

import { AtlasFixtureSchema } from "./atlas/fixtures.js";
import { loadAgentCasesFromFile } from "./cases.js";
import { loadFixture } from "./fixtures.js";

const cases = loadAgentCasesFromFile(
  path.join(import.meta.dirname, "..", "datasets", "atlas-admin.yml"),
);

describe("atlas-admin dataset", () => {
  it("has uniquely named cases, all from the ported source", () => {
    const names = cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const testCase of cases) {
      expect(testCase.tags, testCase.name).toContain("ported");
    }
  });

  it("gives every case a script, so it runs offline", () => {
    for (const testCase of cases) {
      const custom = testCase.input.custom as { script?: unknown[] };
      expect(custom.script?.length, testCase.name).toBeGreaterThan(0);
    }
  });

  // The accuracy tests invent their own ids. A script that names a project
  // or cluster the seed lacks would only fail as a confusing tool error.
  it("only names projects and clusters that the case's seed holds", () => {
    for (const testCase of cases) {
      const custom = testCase.input.custom as {
        toolSetup: { mockAtlas: string };
        script: { toolCalls?: { args: Record<string, unknown> }[] }[];
      };
      const seed = AtlasFixtureSchema.parse(
        loadFixture("mockAtlas", custom.toolSetup.mockAtlas),
      );
      for (const { args } of custom.script.flatMap((t) => t.toolCalls ?? [])) {
        if (typeof args.projectId !== "string") continue;
        const project = seed.projects.find((p) => p.id === args.projectId);
        expect(project, `${testCase.name}: project ${args.projectId}`).toBeDefined();
        if (typeof args.clusterName !== "string") continue;
        expect(
          project!.clusters.map((c) => c.name),
          `${testCase.name}: cluster ${args.clusterName}`,
        ).toContain(args.clusterName);
      }
    }
  });
});
