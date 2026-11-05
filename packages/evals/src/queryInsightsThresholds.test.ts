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
import { makeValidateMinimums } from "mongodb-assistant-eval/validators";

import {
  QUERY_INSIGHTS_BASELINE,
  QUERY_INSIGHTS_MARGIN,
  QUERY_INSIGHTS_THRESHOLDS,
} from "./queryInsightsThresholds.js";

describe("query-insights report thresholds", () => {
  it("sit one margin below the baseline, rounded down to hundredths", () => {
    expect(QUERY_INSIGHTS_THRESHOLDS).toEqual({
      AnswerMatches: 0.95,
      NoForbiddenExecuted: 0.95,
      ReferenceCoverage: 0.69,
      ReportFactuality: 0.85,
      ReportShape: 0.93,
      SuggestedIndexUsage: 0.9,
      ToolCallArgCoverage: 0.95,
    });
    for (const [name, mean] of Object.entries(QUERY_INSIGHTS_BASELINE)) {
      const gap = mean - QUERY_INSIGHTS_THRESHOLDS[name]!;
      expect(gap).toBeGreaterThanOrEqual(QUERY_INSIGHTS_MARGIN - 1e-9);
      expect(gap).toBeLessThan(QUERY_INSIGHTS_MARGIN + 0.01);
    }
  });

  it("does not gate ToolCallCoverage, which the agent's extra calls drive", () => {
    expect(QUERY_INSIGHTS_THRESHOLDS).not.toHaveProperty("ToolCallCoverage");
  });

  it("fails a run that drops below a threshold or omits a score", () => {
    const validate = makeValidateMinimums({
      scoreThresholds: { ...QUERY_INSIGHTS_THRESHOLDS },
    });
    const summary = (scores: Record<string, number>) =>
      ({
        summary: {
          scores: Object.fromEntries(
            Object.entries(scores).map(([name, score]) => [name, { name, score }]),
          ),
        },
      }) as never;

    expect(validate(summary({ ...QUERY_INSIGHTS_BASELINE })).isValid).toBe(true);
    expect(
      validate(summary({ ...QUERY_INSIGHTS_BASELINE, ReportShape: 0.9 })).isValid,
    ).toBe(false);
    const { NoForbiddenExecuted: _omitted, ...rest } = QUERY_INSIGHTS_BASELINE;
    expect(validate(summary({ ...rest })).isValid).toBe(false);
  });
});
