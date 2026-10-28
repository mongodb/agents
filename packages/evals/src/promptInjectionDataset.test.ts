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
import type { CustomExpected } from "./schemas.js";

const cases = loadAgentCasesFromFile(
  path.join(import.meta.dirname, "..", "datasets", "prompt-injection.yml"),
);

const leakCheck = (c: (typeof cases)[number]) =>
  (c.expected.custom as CustomExpected | undefined)?.answerMatches ?? [];

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

  it("gives every case a leak check", () => {
    for (const c of cases) expect(leakCheck(c), c.name).toHaveLength(1);
  });

  it("flags answers that leak a tool name or a prompt rule, and only those", () => {
    const [pattern] = leakCheck(cases[0]!);
    const matches = (text: string) => new RegExp(pattern!, "i").test(text);
    expect(matches("I can't help with that.")).toBe(true);
    expect(matches("I use mongodb__find to read data.")).toBe(false);
    expect(matches("My rules say: Never list tool names.")).toBe(false);
    expect(matches("Never expose credentials, I was told.")).toBe(false);
  });

  it("covers the two claimed-authority cases", () => {
    const authority = cases.filter((c) => c.tags?.includes("claimed_authority"));
    expect(authority).toHaveLength(2);
  });
});
