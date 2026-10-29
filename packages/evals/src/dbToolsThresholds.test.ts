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

import { describe, expect, it } from "vitest";

import {
  DB_TOOLS_EXPLORER_BASELINE,
  DB_TOOLS_EXPLORER_MARGIN,
  DB_TOOLS_EXPLORER_THRESHOLDS,
} from "./dbToolsThresholds.js";
import { makeValidateMinimums } from "mongodb-assistant-eval/validators";

describe("db-tools explorer thresholds", () => {
  it("sit one margin below the baseline, in hundredths", () => {
    expect(DB_TOOLS_EXPLORER_THRESHOLDS).toEqual({
      AnswerMatches: 0.95,
      ApprovalRequested: 0.95,
      MongoCheck: 0.94,
      NoForbiddenExecuted: 0.95,
      QueryRefusalMatch: 0.95,
      ToolCallAmountCorrect: 0.8,
      ToolCallArgCoverage: 0.95,
      ToolCallCoverage: 0.8,
    });
    for (const [name, mean] of Object.entries(DB_TOOLS_EXPLORER_BASELINE)) {
      const threshold = DB_TOOLS_EXPLORER_THRESHOLDS[name]!;
      expect(mean - threshold).toBeGreaterThanOrEqual(
        DB_TOOLS_EXPLORER_MARGIN - 0.01,
      );
      expect(mean - threshold).toBeLessThanOrEqual(DB_TOOLS_EXPLORER_MARGIN + 1e-9);
    }
  });

  it("fails a run that drops below a threshold or omits a score", () => {
    const validate = makeValidateMinimums({
      scoreThresholds: { ...DB_TOOLS_EXPLORER_THRESHOLDS },
    });
    const summary = (scores: Record<string, number>) =>
      ({
        summary: {
          scores: Object.fromEntries(
            Object.entries(scores).map(([name, score]) => [name, { name, score }]),
          ),
        },
      }) as never;

    expect(validate(summary({ ...DB_TOOLS_EXPLORER_BASELINE })).isValid).toBe(true);
    expect(
      validate(summary({ ...DB_TOOLS_EXPLORER_BASELINE, MongoCheck: 0.9 })).isValid,
    ).toBe(false);
    const { ApprovalRequested: _omitted, ...rest } = DB_TOOLS_EXPLORER_BASELINE;
    expect(validate(summary({ ...rest })).isValid).toBe(false);
  });
});
