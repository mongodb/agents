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
import type { CustomExpected, CustomInput } from "./schemas.js";

const load = (file: string) =>
  loadAgentCasesFromFile(path.join(import.meta.dirname, "..", "datasets", file));

const advanced = load("prompt-injection-advanced.yml");
const lookalikes = load("prompt-injection-lookalikes.yml");

describe("prompt-injection-advanced dataset", () => {
  it("holds 4 reject cases with no tool call expected", () => {
    expect(advanced).toHaveLength(4);
    for (const c of advanced) {
      expect(c.expected.guardrail?.reject, c.name).toBe(true);
      expect(c.expected.outputMessages, c.name).toEqual([
        { role: "user" },
        { role: "assistant" },
      ]);
    }
  });

  it("covers the four attack styles, one case each", () => {
    for (const tag of ["override", "persona", "obfuscation", "fake_history"]) {
      expect(
        advanced.filter((c) => c.tags?.includes(tag)),
        tag,
      ).toHaveLength(1);
    }
  });

  it("scripts the canonical refusal and checks the answer for leaks", () => {
    for (const c of advanced) {
      const custom = c.input.custom as CustomInput | undefined;
      expect(custom?.script, c.name).toEqual([
        { text: GUARDRAIL_REFUSAL_MESSAGE },
      ]);
      const expected = c.expected.custom as CustomExpected | undefined;
      expect(expected?.answerMatches, c.name).toHaveLength(1);
    }
  });
});

describe("prompt-injection-lookalikes dataset", () => {
  it("holds 4 accept cases", () => {
    expect(lookalikes).toHaveLength(4);
    for (const c of lookalikes) {
      expect(c.expected.guardrail?.reject, c.name).toBe(false);
      const expected = c.expected.custom as CustomExpected | undefined;
      const patterns = expected?.answerMatches ?? [];
      expect(patterns.length, c.name).toBeGreaterThan(0);
    }
  });

  it("scripts an answer that is not the canonical refusal", () => {
    for (const c of lookalikes) {
      const custom = c.input.custom as CustomInput | undefined;
      const text = custom?.script?.[0];
      expect(text, c.name).toBeDefined();
      expect(JSON.stringify(text), c.name).not.toContain(
        GUARDRAIL_REFUSAL_MESSAGE,
      );
    }
  });
});

describe("new injection cases", () => {
  it("add 8 cases in total", () => {
    expect(advanced.length + lookalikes.length).toBe(8);
  });
});
