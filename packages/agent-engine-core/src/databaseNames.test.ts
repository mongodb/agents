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
  DATABASE_LIST_NOTE,
  createDatabaseMatcher,
  describeDatabaseNames,
  validateDatabaseNames,
} from "./databaseNames.js";

describe("validateDatabaseNames", () => {
  it("accepts an omitted list", () => {
    expect(() => validateDatabaseNames()).not.toThrow();
  });

  it("accepts an empty list", () => {
    expect(() => validateDatabaseNames([])).not.toThrow();
  });

  it("accepts a database name", () => {
    expect(() => validateDatabaseNames(["orders"])).not.toThrow();
  });

  it("accepts a regular expression", () => {
    expect(() => validateDatabaseNames([/^tenant_\d+$/])).not.toThrow();
  });

  it("accepts the i and u flags", () => {
    expect(() => validateDatabaseNames([/^Analytics$/iu])).not.toThrow();
  });

  it("accepts names and regular expressions together", () => {
    expect(() =>
      validateDatabaseNames(["orders", /^tenant_\d+$/]),
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
    expect(createDatabaseMatcher([])?.("orders")).toBe(false);
  });

  it("throws on an invalid entry", () => {
    expect(() => createDatabaseMatcher(["a.b"])).toThrow(/databaseNames/);
  });

  describe("with a string entry", () => {
    const matches = createDatabaseMatcher(["orders"]);

    it("matches the exact name", () => {
      expect(matches?.("orders")).toBe(true);
    });

    it("does not match a name that extends it", () => {
      expect(matches?.("orders_archive")).toBe(false);
    });

    it("does not match a name that it extends", () => {
      expect(matches?.("my_orders")).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(matches?.("Orders")).toBe(false);
    });
  });

  describe("with a regular expression entry", () => {
    const matches = createDatabaseMatcher([/orders/, /tenant_\d+/]);

    it.each(["orders", "tenant_12"])(
      "matches %s, which the expression covers entirely",
      (name) => {
        expect(matches?.(name)).toBe(true);
      },
    );

    it.each(["orders_archive", "tenant_12_secret"])(
      "does not match %s, which has extra text after the match",
      (name) => {
        expect(matches?.(name)).toBe(false);
      },
    );

    it("does not match a name with extra text before the match", () => {
      expect(matches?.("my_orders")).toBe(false);
    });
  });

  describe("with alternation in a regular expression", () => {
    const matches = createDatabaseMatcher([/a|b/]);

    it.each(["a", "b"])("matches %s as a whole name", (name) => {
      expect(matches?.(name)).toBe(true);
    });

    it.each(["ab", "xb"])(
      "does not match %s, which only contains an alternative",
      (name) => {
        expect(matches?.(name)).toBe(false);
      },
    );
  });

  it("honors the i flag", () => {
    expect(createDatabaseMatcher([/orders/i])?.("ORDERS")).toBe(true);
  });

  it("gives the same answer on a second call", () => {
    const matches = createDatabaseMatcher([/orders/i]);
    matches?.("ORDERS");
    expect(matches?.("ORDERS")).toBe(true);
  });

  describe("with a string and a regular expression", () => {
    const matches = createDatabaseMatcher(["orders", /^tenant_\d+$/]);

    it("matches the string", () => {
      expect(matches?.("orders")).toBe(true);
    });

    it("matches the regular expression", () => {
      expect(matches?.("tenant_7")).toBe(true);
    });

    it("does not match a name neither covers", () => {
      expect(matches?.("admin")).toBe(false);
    });
  });
});

describe("describeDatabaseNames", () => {
  it("says every database is allowed when omitted", () => {
    expect(describeDatabaseNames()).toBe("You can use all databases.");
  });

  it("says no databases are allowed for an empty list", () => {
    expect(describeDatabaseNames([])).toBe(
      [
        "No databases are allowed. Do not run database tools.",
        "",
        DATABASE_LIST_NOTE,
      ].join("\n"),
    );
  });

  it("lists names and shows regular expressions as patterns", () => {
    expect(describeDatabaseNames(["orders", /^tenant_\d+$/])).toBe(
      [
        "Access is limited to these databases. Do not use any other database:",
        "- orders",
        "- names matching the whole regular expression /^tenant_\\d+$/",
        "",
        DATABASE_LIST_NOTE,
      ].join("\n"),
    );
  });
});
