/**
 * Renders query stats the way Query Insights renders them.
 *
 * Port of `QueryStatsFormatter.java`, which itself follows
 * `client/packages/handlebars-helpers/formatNumber.ts`. The two stay
 * aligned through `queryStatsDisplay.conformance.json`.
 *
 * Two client behaviours are left out, and neither is reachable from query
 * stats: `toFixed` switches to exponential notation at 1e21 and drops
 * grouping, and a negative value rounding to zero renders as `-0`.
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

interface Decimal {
  sign: 1 | -1;
  digits: bigint;
  scale: number;
}

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
  // The trailing space matches the client: it appends the prefix after a
  // space even when the prefix is empty. Callers that embed the string trim it.
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

/** Mirrors `Backgrid.NumberFormatter`: `toFixed`, then comma-grouped thousands. */
function fixed(value: number, decimals: number): string {
  const rounded = toPlain(setScale(fromDouble(value), decimals));
  const point = rounded.indexOf(".");
  const whole = point < 0 ? rounded : rounded.slice(0, point);
  const fraction = point < 0 ? "" : rounded.slice(point);
  return group(whole) + fraction;
}

/** Mirrors `parseFloat(sig.toPrecision(3))`: round, then drop trailing zeros. */
function threeSignificantFigures(value: number): string {
  return toPlain(stripTrailingZeros(roundPrecision(fromDouble(value), 3)));
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

/**
 * Java `new BigDecimal(double)` uses the exact binary value, not
 * `Double.toString`. Later `setScale` and `MathContext` rounding follow
 * that decimal, which is why 1.005 renders as 1.00.
 */
function fromDouble(value: number): Decimal {
  if (!Number.isFinite(value)) {
    throw new Error("Cannot format a non-finite number as a decimal");
  }
  if (value === 0) return { sign: 1, digits: 0n, scale: 0 };

  const bits = doubleToBits(value);
  const sign: 1 | -1 = (bits >> 63n) === 0n ? 1 : -1;
  let exponent = Number((bits >> 52n) & 0x7ffn);
  let significand =
    exponent === 0
      ? (bits & ((1n << 52n) - 1n)) << 1n
      : (bits & ((1n << 52n) - 1n)) | (1n << 52n);
  exponent -= 1075;
  while ((significand & 1n) === 0n) {
    significand >>= 1n;
    exponent++;
  }
  if (exponent < 0) {
    const pow = -exponent;
    return { sign, digits: significand * 5n ** BigInt(pow), scale: pow };
  }
  return { sign, digits: significand << BigInt(exponent), scale: 0 };
}

function doubleToBits(value: number): bigint {
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = value;
  return new BigUint64Array(buf)[0] ?? 0n;
}

function setScale(dec: Decimal, newScale: number): Decimal {
  if (dec.digits === 0n) return { sign: 1, digits: 0n, scale: newScale };
  const delta = dec.scale - newScale;
  if (delta === 0) return { ...dec, scale: newScale };
  if (delta < 0) {
    return {
      sign: dec.sign,
      digits: dec.digits * 10n ** BigInt(-delta),
      scale: newScale,
    };
  }
  const divisor = 10n ** BigInt(delta);
  let quotient = dec.digits / divisor;
  const remainder = dec.digits % divisor;
  if (remainder * 2n >= divisor) quotient += 1n;
  return { sign: dec.sign, digits: quotient, scale: newScale };
}

function roundPrecision(dec: Decimal, precision: number): Decimal {
  if (dec.digits === 0n) return { sign: 1, digits: 0n, scale: 0 };
  const length = dec.digits.toString().length;
  if (length <= precision) return dec;
  return setScale(dec, dec.scale - (length - precision));
}

function stripTrailingZeros(dec: Decimal): Decimal {
  if (dec.digits === 0n) return { sign: 1, digits: 0n, scale: 0 };
  let digits = dec.digits;
  let scale = dec.scale;
  while (digits % 10n === 0n) {
    digits /= 10n;
    scale -= 1;
  }
  return { sign: dec.sign, digits, scale };
}

function toPlain(dec: Decimal): string {
  if (dec.digits === 0n) {
    return dec.scale > 0 ? `0.${"0".repeat(dec.scale)}` : "0";
  }
  const digits = dec.digits.toString();
  let rendered: string;
  if (dec.scale <= 0) {
    rendered = digits + "0".repeat(-dec.scale);
  } else if (digits.length <= dec.scale) {
    rendered = `0.${"0".repeat(dec.scale - digits.length)}${digits}`;
  } else {
    const point = digits.length - dec.scale;
    rendered = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return dec.sign < 0 ? `-${rendered}` : rendered;
}
