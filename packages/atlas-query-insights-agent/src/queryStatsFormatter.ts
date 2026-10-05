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

const SI_PREFIXES = ["", "k", "M", "G", "T", "P", "E", "Z", "Y"] as const;
const MICROS_IN_MILLI = 1000;
const MILLIS_IN_SECOND = 1000;
const MILLIS_IN_MINUTE = 60 * MILLIS_IN_SECOND;
const MILLIS_IN_HOUR = 60 * MILLIS_IN_MINUTE;

export const NOT_AVAILABLE = "N/A";

export const UNITS_LEGEND = `- Durations: \`μs\` microseconds, \`ms\` milliseconds, \`s\` seconds, \`min\` minutes, \`hr\` hours.
- Counts: a bare number below one thousand, otherwise \`k\` thousand, \`M\` million, \`G\` billion, \`T\` trillion, \`P\` quadrillion.
- Bytes: \`B\` bytes, \`kB\` kilobytes, \`MB\` megabytes, \`GB\` gigabytes, \`TB\` terabytes.
- Ratios carry no unit and are given to two decimal places.
- Values beyond these limits continue with the remaining SI prefixes in order.`;

const FORMATTERS: Record<string, (value: number) => string> = {
  execCount: count,
  totalTimeToResponseMicros: micros,
  totalWorkingMillis: millis,
  avgWorkingMillis: millis,
  lastExecMicros: micros,
  keysExamined: count,
  docsExamined: count,
  docsReturned: count,
  keysExaminedRatio: ratio,
  docsExaminedRatio: ratio,
  bytesRead: bytes,
};

export function displayedStats(): ReadonlySet<string> {
  return new Set(Object.keys(FORMATTERS));
}

export function display(statKey: string, value: number): string {
  const formatter = FORMATTERS[statKey];
  if (!formatter) {
    throw new Error(`no display format for stat: ${statKey}`);
  }
  return formatter(value);
}

function ratio(value: number): string {
  if (isInvalid(value)) return NOT_AVAILABLE;
  return value === 0 ? "0" : fixed(value, 2);
}

function count(value: number): string {
  return siPrefix(value);
}

function bytes(value: number): string {
  return `${siPrefix(value)}B`;
}

function millis(value: number): string {
  return time(value, false);
}

function micros(value: number): string {
  return time(value, true);
}

function siPrefix(value: number): string {
  if (isInvalid(value)) return NOT_AVAILABLE;
  return value < 1 ? ratio(value) : si(value);
}

function si(num: number): string {
  if (num === 0) return "0";
  let significand = Math.abs(num);
  let exponent = 0;
  while (significand >= 1000 && exponent < 24) {
    significand /= 1000;
    exponent += 3;
  }
  while (significand < 1 && exponent > -24) {
    significand *= 1000;
    exponent -= 3;
  }

  const sign = num < 0 ? "-" : "";
  const prefix = SI_PREFIXES[exponent / 3] ?? "";
  if (significand > 1000) {
    return sign + fixed(significand, 0) + prefix;
  }
  // The prefix is appended after a space even when the prefix is empty.
  // Callers that embed the string trim it.
  return `${sign}${threeSignificantFigures(significand)} ${prefix}`;
}

function time(value: number, isMicros: boolean): string {
  if (isInvalid(value)) return NOT_AVAILABLE;

  let millisValue = value;
  if (isMicros) {
    if (millisValue < MICROS_IN_MILLI) return `${fixed(millisValue, 0)} μs`;
    millisValue /= MICROS_IN_MILLI;
  }

  if (millisValue !== 0 && Math.abs(millisValue) < 1) {
    return `${fixed(millisValue * MICROS_IN_MILLI, 0)} μs`;
  }

  let converted: number;
  let units: string;
  if (millisValue < MILLIS_IN_SECOND) {
    converted = millisValue;
    units = " ms";
  } else if (millisValue < MILLIS_IN_MINUTE) {
    converted = millisValue / MILLIS_IN_SECOND;
    units = " s";
  } else if (millisValue < MILLIS_IN_HOUR) {
    converted = millisValue / MILLIS_IN_MINUTE;
    units = " min";
  } else {
    converted = millisValue / MILLIS_IN_HOUR;
    units = " hr";
  }

  const useDecimal =
    !isMathematicalInteger(converted) &&
    (isMicros || millisValue >= MILLIS_IN_SECOND);
  return fixed(converted, useDecimal ? 2 : 0) + units;
}

function fixed(value: number, decimals: number): string {
  const rounded = value.toFixed(decimals);
  const point = rounded.indexOf(".");
  const whole = point < 0 ? rounded : rounded.slice(0, point);
  const fraction = point < 0 ? "" : rounded.slice(point);
  return group(whole) + fraction;
}

function threeSignificantFigures(value: number): string {
  return String(Number(value.toPrecision(3)));
}

function group(whole: string): string {
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return negative ? `-${grouped}` : grouped;
}

function isMathematicalInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function isInvalid(value: number): boolean {
  return Number.isNaN(value) || !Number.isFinite(value);
}
