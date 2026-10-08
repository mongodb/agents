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

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

export function parseDurationMs(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Use a number and a unit, for example 30s, 5m, or 1h.`,
    );
  }
  return Number(match[1]) * (UNITS[match[2] ?? ""] ?? 0);
}

/** Parses a rate such as `45/h` into sessions per hour. */
export function parseRatePerHour(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\/h$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid rate "${value}". Use a number per hour, for example 45/h.`);
  }
  const rate = Number(match[1]);
  if (rate <= 0) {
    throw new Error(`Rate must be greater than 0, got ${value}.`);
  }
  return rate;
}

export function parseDurationList(value: string): number[] {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid duration list "${value}".`);
  }
  return parts.map((part) => parseDurationMs(part));
}
