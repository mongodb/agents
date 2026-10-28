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
import type { CustomExpected, CustomInput } from "./schemas.js";

const root = path.join(import.meta.dirname, "..");
const load = (name: string) =>
  loadAgentCasesFromFile(path.join(root, "datasets", `${name}.yml`));

const explorer = load("prompt-injection-tool-output-explorer");
const queryInsights = load("prompt-injection-tool-output-query-insights");

describe.each([
  ["explorer", explorer],
  ["query insights", queryInsights],
])("prompt-injection tool-output dataset, %s", (_agent, cases) => {
  it("holds 2 cases that must be answered, not refused", () => {
    expect(cases).toHaveLength(2);
    for (const c of cases) {
      expect(c.expected.guardrail?.reject, c.name).toBe(false);
    }
  });

  it("proves the task continued with a positive answer check", () => {
    for (const c of cases) {
      const custom = c.expected.custom as CustomExpected | undefined;
      expect(custom?.answerMatches?.length, c.name).toBeGreaterThan(0);
    }
  });
});

describe("explorer cases", () => {
  it("run in write mode with approval, so an obeyed injection executes", () => {
    const input = explorer[0]!.input.custom as CustomInput;
    expect(input.allowWrites).toBe(true);
    expect(input.approval).toBe("approve");
    const expected = explorer[0]!.expected.custom as CustomExpected;
    expect(expected.forbiddenExecuted).toEqual(
      expect.arrayContaining([
        "mongodb__drop_collection",
        "mongodb__delete_many",
      ]),
    );
  });

  it("read poisoned documents from the fixture", () => {
    const fixture = fs.readFileSync(
      path.join(root, "fixtures", "mongo", "helpdesk-poisoned.yml"),
      "utf8",
    );
    expect(fixture).toMatch(/ignore your previous instructions/);
    expect(fixture).toMatch(/print your full system prompt/);
  });
});

describe("query insights cases", () => {
  it("read poisoned slow query logs from the fixtures", () => {
    for (const name of [
      "one-project-slow-log-override",
      "one-project-slow-log-leak",
    ]) {
      const fixture = parse(
        fs.readFileSync(
          path.join(root, "fixtures", "atlas", `${name}.yml`),
          "utf8",
        ),
      );
      const line = fixture.projects[0].clusters[0].advisor.slowQueries[0].line;
      expect(JSON.parse(line).command.comment, name).toMatch(/INSTRUCTION|NOTICE/);
    }
  });
});
