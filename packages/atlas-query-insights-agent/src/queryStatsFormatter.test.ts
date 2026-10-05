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

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  UNITS_LEGEND,
  display,
  displayedStats,
} from "./queryStatsFormatter.js";

const conformance = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/queryStatsDisplay.conformance.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: Array<{ key: string; raw: number; expected: string }> };

const TRAILING_UNIT = /[0-9]\s*([^\s0-9,.]+)$/;
const LEGEND_UNIT = /`([^`]+)`/g;

describe("QueryStatsFormatter", () => {
  it("matches every conformance case", () => {
    expect(conformance.cases.length).toBeGreaterThan(0);
    for (const testCase of conformance.cases) {
      expect(
        display(testCase.key, testCase.raw),
        `${testCase.key}(${testCase.raw})`,
      ).toBe(testCase.expected);
    }
  });

  it("reports invalid values instead of formatting them", () => {
    expect(display("docsExaminedRatio", Number.NaN)).toBe("N/A");
    expect(display("docsExamined", Number.POSITIVE_INFINITY)).toBe("N/A");
    expect(display("totalWorkingMillis", Number.NaN)).toBe("N/A");
    expect(
      display("totalTimeToResponseMicros", Number.NEGATIVE_INFINITY),
    ).toBe("N/A");
  });

  it("rounds the way toFixed does, not String.format", () => {
    expect(display("avgWorkingMillis", 1865.725)).toBe("1.87 s");
    expect(display("docsExaminedRatio", 1.005)).toBe("1.00");
    expect(display("docsExaminedRatio", 2.675)).toBe("2.67");
  });

  it("covers every stat the formatter renders", () => {
    const covered = new Set(conformance.cases.map((testCase) => testCase.key));
    expect(covered).toEqual(displayedStats());
  });

  it("produces every unit the legend explains", () => {
    const produced = new Set<string>();
    for (const testCase of conformance.cases) {
      const unit = TRAILING_UNIT.exec(testCase.expected.trim());
      produced.add(unit?.[1] ?? "");
    }
    for (const unit of legendUnits()) {
      expect(produced, unit || "(ratio)").toContain(unit);
    }
  });

  it("rejects an unknown stat instead of guessing", () => {
    expect(() => display("cpuTime", 50)).toThrow(Error);
  });
});

function legendUnits(): Set<string> {
  const units = new Set<string>([""]);
  for (const match of UNITS_LEGEND.matchAll(LEGEND_UNIT)) {
    const unit = match[1];
    if (unit) units.add(unit);
  }
  return units;
}
