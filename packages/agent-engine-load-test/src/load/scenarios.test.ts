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

import { buildScenario } from "./scenarios.js";

describe("buildScenario", () => {
  it("builds a two-turn session 30s apart", () => {
    const scenario = buildScenario("same-session");
    expect(scenario.sessions).toHaveLength(1);
    expect(scenario.sessions[0]?.turns.map((turn) => turn.delayBeforeMs)).toEqual([
      0, 30_000,
    ]);
    expect(scenario.prompt).toBe("List my Atlas projects. Names only.");
  });

  it("waits until the idle TTL plus a minute", () => {
    expect(
      buildScenario("after-ttl").sessions[0]?.turns[1]?.delayBeforeMs,
    ).toBe(660_000);
  });

  it("spaces ttl-probe follow-ups at the given gaps", () => {
    const scenario = buildScenario("ttl-probe");
    expect(scenario.sessions[0]?.turns.map((turn) => turn.delayBeforeMs)).toEqual([
      0, 280_000, 590_000, 620_000,
    ]);
  });

  it("starts concurrency sessions together", () => {
    const scenario = buildScenario("concurrency", { concurrency: 6 });
    expect(scenario.sessions).toHaveLength(6);
    expect(scenario.sessions.every((session) => session.startAfterMs === 0)).toBe(
      true,
    );
    expect(scenario.sessions[0]?.turns).toHaveLength(1);
  });

  it("spaces a ramp by the hourly rate", () => {
    const scenario = buildScenario("ramp", { sessions: 4, ratePerHour: 60 });
    expect(scenario.sessions.map((session) => session.startAfterMs)).toEqual([
      0, 60_000, 120_000, 180_000,
    ]);
  });

  it("schedules recovery probes until the attempt cap", () => {
    const scenario = buildScenario("recovery-probe", {
      sessions: 3,
      intervalMs: 300_000,
    });
    expect(scenario.stopWhen).toBe("first-success");
    expect(scenario.sessions.map((session) => session.startAfterMs)).toEqual([
      0, 300_000, 600_000,
    ]);
  });
});
