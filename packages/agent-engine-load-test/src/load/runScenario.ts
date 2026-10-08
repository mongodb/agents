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
import * as path from "node:path";

import type { Clock } from "../clock.js";
import type { Scenario, ScenarioSession } from "./scenarios.js";
import type { TurnResult } from "./turnResult.js";

export interface ScenarioInvokeInput {
  message: string;
  sessionId?: string;
}

export interface ScenarioInvokeResult {
  kind: "completed" | "suspended";
  sessionId: string;
  executionId?: string;
}

export type ScenarioInvoke = (
  input: ScenarioInvokeInput,
) => Promise<ScenarioInvokeResult>;

export async function runScenario(options: {
  scenario: Scenario;
  invoke: ScenarioInvoke;
  clock: Clock;
  clientLogPath: string;
}): Promise<TurnResult[]> {
  fs.mkdirSync(path.dirname(options.clientLogPath), { recursive: true });
  fs.writeFileSync(options.clientLogPath, "");
  if (options.scenario.stopWhen === "first-success") {
    return runUntilSuccess(options);
  }
  const groups = await Promise.all(
    options.scenario.sessions.map((session) => runSession(options, session)),
  );
  return groups.flat();
}

async function runUntilSuccess(options: {
  scenario: Scenario;
  invoke: ScenarioInvoke;
  clock: Clock;
  clientLogPath: string;
}): Promise<TurnResult[]> {
  const started = options.clock.now().getTime();
  const results: TurnResult[] = [];
  for (const session of options.scenario.sessions) {
    const wait = session.startAfterMs - (options.clock.now().getTime() - started);
    if (wait > 0) {
      await options.clock.sleep(wait);
    }
    const turns = await runTurns(options, session);
    results.push(...turns);
    if (
      turns.some(
        (turn) => turn.status === "completed" || turn.status === "suspended",
      )
    ) {
      break;
    }
  }
  return results;
}

async function runSession(
  options: {
    scenario: Scenario;
    invoke: ScenarioInvoke;
    clock: Clock;
    clientLogPath: string;
  },
  session: ScenarioSession,
): Promise<TurnResult[]> {
  if (session.startAfterMs > 0) {
    await options.clock.sleep(session.startAfterMs);
  }
  return runTurns(options, session);
}

async function runTurns(
  options: {
    scenario: Scenario;
    invoke: ScenarioInvoke;
    clock: Clock;
    clientLogPath: string;
  },
  session: ScenarioSession,
): Promise<TurnResult[]> {
  const turns: TurnResult[] = [];
  let sessionId: string | undefined;
  for (const [index, spec] of session.turns.entries()) {
    if (spec.delayBeforeMs > 0) {
      await options.clock.sleep(spec.delayBeforeMs);
    }
    const startedAt = options.clock.now().toISOString();
    try {
      const result = await options.invoke({
        message: options.scenario.prompt,
        ...(sessionId ? { sessionId } : {}),
      });
      sessionId = result.sessionId;
      const turn: TurnResult = {
        scenario: options.scenario.name,
        sessionLabel: session.label,
        turn: index + 1,
        sessionId: result.sessionId,
        executionId: result.executionId ?? null,
        startedAt,
        endedAt: options.clock.now().toISOString(),
        status: result.kind,
      };
      appendTurn(options.clientLogPath, turn);
      turns.push(turn);
    } catch (error) {
      const turn: TurnResult = {
        scenario: options.scenario.name,
        sessionLabel: session.label,
        turn: index + 1,
        sessionId: sessionId ?? null,
        executionId: null,
        startedAt,
        endedAt: options.clock.now().toISOString(),
        status: "error",
        ...errorFields(error),
      };
      appendTurn(options.clientLogPath, turn);
      turns.push(turn);
      break;
    }
  }
  return turns;
}

function appendTurn(file: string, turn: TurnResult): void {
  fs.appendFileSync(file, `${JSON.stringify(turn)}\n`);
}

function errorFields(error: unknown): {
  errorCode?: string;
  errorMessage: string;
} {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      errorMessage: error.message,
      ...(typeof code === "string" ? { errorCode: code } : {}),
    };
  }
  return { errorMessage: String(error) };
}

export function readTurnLog(file: string): TurnResult[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  const body = fs.readFileSync(file, "utf8").trim();
  if (!body) {
    return [];
  }
  return body.split("\n").map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${file}:${index + 1} is not JSON`);
    }
    if (!isTurnResult(value)) {
      throw new Error(`${file}:${index + 1} is not a turn result`);
    }
    return value;
  });
}

function isTurnResult(value: unknown): value is TurnResult {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const turn = value as Record<string, unknown>;
  return (
    typeof turn["scenario"] === "string" &&
    typeof turn["sessionLabel"] === "string" &&
    typeof turn["turn"] === "number" &&
    typeof turn["startedAt"] === "string" &&
    typeof turn["endedAt"] === "string" &&
    (turn["status"] === "completed" ||
      turn["status"] === "suspended" ||
      turn["status"] === "error")
  );
}
