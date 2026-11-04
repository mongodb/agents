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


import { makeValidateMinimums } from "mongodb-assistant-eval/validators";
import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_EXPLORER_BASELINE,
  KNOWLEDGE_EXPLORER_MARGIN,
  KNOWLEDGE_EXPLORER_THRESHOLDS,
} from "./knowledgeThresholds.js";

const summary = (scores: Record<string, number>) =>
  ({
    summary: {
      scores: Object.fromEntries(
        Object.entries(scores).map(([name, score]) => [name, { name, score }]),
      ),
    },
  }) as never;

describe("knowledge explorer thresholds", () => {
  it("sit one margin below the baseline, in hundredths", () => {
    expect(KNOWLEDGE_EXPLORER_THRESHOLDS).toEqual({
      ReferenceAlignment: 0.81,
      BinaryNdcgAt5: 0.51,
      ToolCallCoverage: 0.76,
    });
    for (const [name, mean] of Object.entries(KNOWLEDGE_EXPLORER_BASELINE)) {
      const gap = mean - KNOWLEDGE_EXPLORER_THRESHOLDS[name]!;
      expect(gap).toBeGreaterThanOrEqual(KNOWLEDGE_EXPLORER_MARGIN - 1e-9);
      expect(gap).toBeLessThanOrEqual(KNOWLEDGE_EXPLORER_MARGIN + 0.01);
    }
  });

  it("fails a run that drops below a threshold or omits a score", () => {
    const validate = makeValidateMinimums({
      scoreThresholds: { ...KNOWLEDGE_EXPLORER_THRESHOLDS },
    });

    expect(validate(summary({ ...KNOWLEDGE_EXPLORER_BASELINE })).isValid).toBe(
      true,
    );
    expect(
      validate(
        summary({ ...KNOWLEDGE_EXPLORER_BASELINE, ReferenceAlignment: 0.6 }),
      ).isValid,
    ).toBe(false);
    const { ToolCallCoverage: _omitted, ...rest } = KNOWLEDGE_EXPLORER_BASELINE;
    expect(validate(summary({ ...rest })).isValid).toBe(false);
  });
});
