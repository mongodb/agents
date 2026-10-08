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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { Clock } from "../clock.js";
import { buildScenario } from "./scenarios.js";
import { readTurnLog, runScenario, type ScenarioInvoke } from "./runScenario.js";

describe("runScenario", () => {
  it("reuses the session id and waits between turns", async () => {
    const calls: Array<string | undefined> = [];
    const invoke: ScenarioInvoke = async (input) => {
      calls.push(input.sessionId);
      return {
        kind: "completed",
        sessionId: "sess-1",
        executionId: `exec-${calls.length}`,
      };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-"));
    const logPath = path.join(dir, "client.jsonl");

    const turns = await runScenario({
      scenario: buildScenario("same-session"),
      invoke,
      clock: steppingClock("2026-10-08T15:00:00.000Z"),
      clientLogPath: logPath,
    });

    expect(calls).toEqual([undefined, "sess-1"]);
    expect(turns.map((turn) => turn.startedAt)).toEqual([
      "2026-10-08T15:00:00.000Z",
      "2026-10-08T15:00:30.000Z",
    ]);
    expect(turns.map((turn) => turn.executionId)).toEqual(["exec-1", "exec-2"]);
    expect(readTurnLog(logPath)).toEqual(turns);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records an error and keeps going with the other sessions", async () => {
    let n = 0;
    const invoke: ScenarioInvoke = async () => {
      n += 1;
      if (n === 1) {
        throw Object.assign(new Error("Access Token limit reached"), {
          code: "STARTUP_FAILED",
        });
      }
      return { kind: "completed", sessionId: "sess-2", executionId: "exec-2" };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-"));
    const turns = await runScenario({
      scenario: buildScenario("concurrency", { concurrency: 2 }),
      invoke,
      clock: steppingClock("2026-10-08T15:00:00.000Z"),
      clientLogPath: path.join(dir, "client.jsonl"),
    });

    expect(turns).toHaveLength(2);
    expect(turns.find((turn) => turn.status === "error")).toMatchObject({
      errorCode: "STARTUP_FAILED",
      errorMessage: "Access Token limit reached",
      sessionId: null,
    });
    expect(turns.find((turn) => turn.status === "completed")?.sessionId).toBe(
      "sess-2",
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stops a recovery probe at the first success", async () => {
    const started: string[] = [];
    const invoke: ScenarioInvoke = async () => {
      if (started.length === 0) {
        started.push("failed");
        throw new Error("not ready");
      }
      started.push("ok");
      return { kind: "completed", sessionId: "sess", executionId: "exec" };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-"));
    const turns = await runScenario({
      scenario: buildScenario("recovery-probe", {
        sessions: 4,
        intervalMs: 60_000,
      }),
      invoke,
      clock: steppingClock("2026-10-08T15:00:00.000Z"),
      clientLogPath: path.join(dir, "client.jsonl"),
    });

    expect(started).toEqual(["failed", "ok"]);
    expect(turns.map((turn) => turn.startedAt)).toEqual([
      "2026-10-08T15:00:00.000Z",
      "2026-10-08T15:01:00.000Z",
    ]);
    expect(turns.map((turn) => turn.status)).toEqual(["error", "completed"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("carries the session id only after a successful first turn", async () => {
    const sessionIds: Array<string | undefined> = [];
    const invoke: ScenarioInvoke = async (input) => {
      sessionIds.push(input.sessionId);
      if (sessionIds.length === 2) {
        throw new Error("turn 2 failed");
      }
      return { kind: "suspended", sessionId: "sess-1", executionId: "exec-1" };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-"));
    const turns = await runScenario({
      scenario: buildScenario("same-session", { gapMs: 1_000 }),
      invoke,
      clock: steppingClock("2026-10-08T15:00:00.000Z"),
      clientLogPath: path.join(dir, "client.jsonl"),
    });

    expect(sessionIds).toEqual([undefined, "sess-1"]);
    expect(turns.map((turn) => turn.status)).toEqual(["suspended", "error"]);
    expect(turns[1]?.sessionId).toBe("sess-1");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

function steppingClock(startIso: string): Clock {
  let current = Date.parse(startIso);
  return {
    now: () => new Date(current),
    sleep: (ms) => {
      current += ms;
      return Promise.resolve();
    },
  };
}
