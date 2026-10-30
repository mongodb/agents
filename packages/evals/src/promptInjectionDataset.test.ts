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

import { GUARDRAIL_REFUSAL_MESSAGE } from "@repo/agent-engine-core";
import { describe, expect, it } from "vitest";

import { loadAgentCasesFromFile } from "./cases.js";
import type { CustomInput } from "./schemas.js";

const cases = loadAgentCasesFromFile(
  path.join(import.meta.dirname, "..", "datasets", "prompt-injection.yml"),
);

describe("prompt-injection dataset", () => {
  it("holds 10 reject cases with no tool call expected", () => {
    expect(cases).toHaveLength(10);
    for (const c of cases) {
      expect(c.expected.guardrail?.reject, c.name).toBe(true);
      expect(c.expected.outputMessages, c.name).toEqual([
        { role: "user" },
        { role: "assistant" },
      ]);
    }
  });

  it("gives every case a scripted refusal turn and no fixture setup", () => {
    for (const c of cases) {
      const custom = c.input.custom as CustomInput | undefined;
      expect(custom?.toolSetup, c.name).toBeUndefined();
      expect(custom?.script, c.name).toEqual([
        { text: GUARDRAIL_REFUSAL_MESSAGE },
      ]);
    }
  });

  it("covers the two claimed-authority cases", () => {
    const authority = cases.filter((c) => c.tags?.includes("claimed_authority"));
    expect(authority).toHaveLength(2);
  });
});
