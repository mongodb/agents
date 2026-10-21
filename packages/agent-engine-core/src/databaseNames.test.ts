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
  createDatabaseMatcher,
  describeDatabaseNames,
  validateDatabaseNames,
} from "./databaseNames.js";

const LIST_NOTE =
  "Database lists in tool results can include databases not listed above. Using one returns an error.";

describe("validateDatabaseNames", () => {
  it("accepts omitted, empty, names, and regular expressions", () => {
    expect(() => validateDatabaseNames()).not.toThrow();
    expect(() => validateDatabaseNames([])).not.toThrow();
    expect(() =>
      validateDatabaseNames(["orders", /^tenant_\d+$/, /^Analytics$/iu]),
    ).not.toThrow();
  });

  it.each([
    ["an empty name", ""],
    ["a name with a dot", "a.b"],
    ["a name with a space", "a b"],
    ["a name with a slash", "a/b"],
    ["a name with a dollar sign", "a$b"],
    ["a name over 64 characters", "a".repeat(65)],
  ])("rejects %s", (_label, name) => {
    expect(() => validateDatabaseNames([name])).toThrow(/databaseNames entries/);
  });

  it.each(["g", "y", "m", "s"])("rejects the %s flag", (flag) => {
    expect(() => validateDatabaseNames([new RegExp("a", flag)])).toThrow(
      /only the i and u flags/,
    );
  });
});

describe("createDatabaseMatcher", () => {
  it("returns undefined when omitted", () => {
    expect(createDatabaseMatcher()).toBeUndefined();
  });

  it("matches nothing for an empty list", () => {
    const matches = createDatabaseMatcher([]);
    expect(matches?.("orders")).toBe(false);
  });

  it("matches strings exactly", () => {
    const matches = createDatabaseMatcher(["orders"]);
    expect(matches?.("orders")).toBe(true);
    expect(matches?.("orders_archive")).toBe(false);
    expect(matches?.("my_orders")).toBe(false);
    expect(matches?.("Orders")).toBe(false);
  });

  it("matches the whole name for a regular expression", () => {
    const matches = createDatabaseMatcher([/orders/, /tenant_\d+/]);
    expect(matches?.("orders")).toBe(true);
    expect(matches?.("orders_archive")).toBe(false);
    expect(matches?.("my_orders")).toBe(false);
    expect(matches?.("tenant_12")).toBe(true);
    expect(matches?.("tenant_12_secret")).toBe(false);
  });

  it("keeps alternation inside the whole-name match", () => {
    const matches = createDatabaseMatcher([/a|b/]);
    expect(matches?.("a")).toBe(true);
    expect(matches?.("b")).toBe(true);
    expect(matches?.("ab")).toBe(false);
    expect(matches?.("xb")).toBe(false);
  });

  it("honors the i flag and gives the same answer on every call", () => {
    const matches = createDatabaseMatcher([/orders/i]);
    expect(matches?.("ORDERS")).toBe(true);
    expect(matches?.("ORDERS")).toBe(true);
  });

  it("allows a database matched by any entry", () => {
    const matches = createDatabaseMatcher(["orders", /^tenant_\d+$/]);
    expect(matches?.("orders")).toBe(true);
    expect(matches?.("tenant_7")).toBe(true);
    expect(matches?.("admin")).toBe(false);
  });

  it("throws on an invalid entry", () => {
    expect(() => createDatabaseMatcher(["a.b"])).toThrow(/databaseNames/);
  });
});

describe("describeDatabaseNames", () => {
  it("returns undefined when omitted", () => {
    expect(describeDatabaseNames()).toBeUndefined();
  });

  it("says no databases are allowed for an empty list", () => {
    expect(describeDatabaseNames([])).toBe(
      ["No databases are allowed. Do not run database tools.", "", LIST_NOTE].join(
        "\n",
      ),
    );
  });

  it("lists names and shows regular expressions as patterns", () => {
    expect(describeDatabaseNames(["orders", /^tenant_\d+$/])).toBe(
      [
        "Access is limited to these databases. Do not use any other database:",
        "- orders",
        "- names matching the whole regular expression /^tenant_\\d+$/",
        "",
        LIST_NOTE,
      ].join("\n"),
    );
  });
});
