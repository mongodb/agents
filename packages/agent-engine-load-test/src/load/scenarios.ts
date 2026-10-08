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

import { parseDurationList, parseDurationMs, parseRatePerHour } from "../duration.js";

export const SCENARIO_NAMES = [
  "same-session",
  "after-ttl",
  "ttl-probe",
  "concurrency",
  "ramp",
  "recovery-probe",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/** Read-only prompt so every turn has to call the Atlas MCP tool. */
export const READ_ONLY_PROMPT = "List my Atlas projects. Names only.";

const DEFAULT_IDLE_TTL_MS = 600_000;

export interface ScenarioTurn {
  /** Wait this long after the previous turn of this session finishes. */
  delayBeforeMs: number;
}

export interface ScenarioSession {
  label: string;
  /** Wait this long after the run starts before the session's first delay. */
  startAfterMs: number;
  turns: ScenarioTurn[];
}

export interface Scenario {
  name: ScenarioName;
  prompt: string;
  sessions: ScenarioSession[];
  /** Stop after the first session that completes or suspends. */
  stopWhen?: "first-success";
}

export interface ScenarioOptions {
  sessions?: number;
  ratePerHour?: number;
  gapMs?: number;
  gapsMs?: number[];
  concurrency?: number;
  intervalMs?: number;
  /** Idle TTL the after-ttl scenario waits past. Default 600s. */
  idleTtlMs?: number;
  prompt?: string;
}

export function scenarioOptionsFromFlags(flags: {
  sessions?: number;
  rate?: string;
  gap?: string;
  gaps?: string;
  concurrency?: number;
  interval?: string;
}): ScenarioOptions {
  return {
    ...(flags.sessions !== undefined ? { sessions: flags.sessions } : {}),
    ...(flags.rate !== undefined ? { ratePerHour: parseRatePerHour(flags.rate) } : {}),
    ...(flags.gap !== undefined ? { gapMs: parseDurationMs(flags.gap) } : {}),
    ...(flags.gaps !== undefined ? { gapsMs: parseDurationList(flags.gaps) } : {}),
    ...(flags.concurrency !== undefined ? { concurrency: flags.concurrency } : {}),
    ...(flags.interval !== undefined
      ? { intervalMs: parseDurationMs(flags.interval) }
      : {}),
  };
}

export function buildScenario(
  name: ScenarioName,
  options: ScenarioOptions = {},
): Scenario {
  const prompt = options.prompt ?? READ_ONLY_PROMPT;
  switch (name) {
    case "same-session":
      return repeated(name, prompt, options.sessions ?? 1, 0, [
        0,
        options.gapMs ?? 30_000,
      ]);
    case "after-ttl":
      return repeated(name, prompt, options.sessions ?? 1, 0, [
        0,
        options.gapMs ?? (options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS) + 60_000,
      ]);
    case "ttl-probe":
      return repeated(name, prompt, options.sessions ?? 1, 0, [
        0,
        ...(options.gapsMs ?? [280_000, 590_000, 620_000]),
      ]);
    case "concurrency":
      return repeated(
        name,
        prompt,
        positive(options.concurrency ?? 6, "concurrency"),
        0,
        [0],
      );
    case "ramp": {
      const count = positive(options.sessions ?? 4, "sessions");
      const rate = options.ratePerHour ?? 60;
      if (rate <= 0) {
        throw new Error(`Rate must be greater than 0, got ${rate}.`);
      }
      return repeated(name, prompt, count, Math.round(3_600_000 / rate), [0]);
    }
    case "recovery-probe": {
      const count = positive(options.sessions ?? 12, "sessions");
      const interval = options.intervalMs ?? 300_000;
      return {
        name,
        prompt,
        stopWhen: "first-success",
        sessions: Array.from({ length: count }, (_, index) => ({
          label: `probe-${index + 1}`,
          startAfterMs: index * interval,
          turns: [{ delayBeforeMs: 0 }],
        })),
      };
    }
    default: {
      const unexpected: never = name;
      throw new Error(`Unknown scenario ${String(unexpected)}`);
    }
  }
}

function repeated(
  name: ScenarioName,
  prompt: string,
  count: number,
  startSpacingMs: number,
  turnDelays: number[],
): Scenario {
  const sessions = positive(count, "sessions");
  return {
    name,
    prompt,
    sessions: Array.from({ length: sessions }, (_, index) => ({
      label: `s${index + 1}`,
      startAfterMs: index * startSpacingMs,
      turns: turnDelays.map((delayBeforeMs) => ({ delayBeforeMs })),
    })),
  };
}

function positive(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer of at least 1, got ${value}.`);
  }
  return value;
}
