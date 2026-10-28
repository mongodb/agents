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

const file = path.join(
  import.meta.dirname,
  "..",
  "datasets",
  "input-guardrail.yml",
);
const cases = loadAgentCasesFromFile(file);
const rejects = cases.filter((c) => c.expected.guardrail?.reject === true);

describe("input-guardrail dataset", () => {
  it("labels every case", () => {
    for (const c of cases) {
      expect(c.expected.guardrail?.reject, c.name).toBeTypeOf("boolean");
    }
  });

  it("has unique names", () => {
    const names = cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no per-case setup, so a case starts no fixtures", () => {
    for (const c of cases) {
      expect(c.input.custom, c.name).toBeUndefined();
    }
  });

  it("holds the 13 reject cases", () => {
    expect(rejects).toHaveLength(13);
  });

  it("expects no tool call on every reject case", () => {
    for (const c of rejects) {
      expect(c.expected.outputMessages, c.name).toEqual([
        { role: "user" },
        { role: "assistant" },
      ]);
    }
  });
});
