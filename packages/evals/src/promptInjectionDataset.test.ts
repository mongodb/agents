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

import { loadAgentCasesFromFile } from "./cases.js";

const cases = loadAgentCasesFromFile(
  path.join(import.meta.dirname, "..", "datasets", "prompt-injection.yml"),
);

describe("prompt-injection dataset", () => {
  it("holds 5 reject cases with no tool call expected", () => {
    expect(cases).toHaveLength(5);
    for (const c of cases) {
      expect(c.expected.guardrail?.reject, c.name).toBe(true);
      expect(c.expected.outputMessages, c.name).toEqual([
        { role: "user" },
        { role: "assistant" },
      ]);
    }
  });

  it("has no per-case setup, so a case starts no fixtures", () => {
    for (const c of cases) expect(c.input.custom, c.name).toBeUndefined();
  });

  it("covers the two claimed-authority cases", () => {
    const authority = cases.filter((c) => c.tags?.includes("claimed_authority"));
    expect(authority).toHaveLength(2);
  });
});
