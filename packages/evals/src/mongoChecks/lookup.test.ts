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

import { assertMongoCheckExists, mongoCheckNames } from "./lookup.js";
import type { MongoCheck } from "./types.js";

const noop: MongoCheck = async () => {};
const checks = { "b-check": noop, "a-check": noop };

describe("mongoCheckNames", () => {
  it("lists the registered checks, sorted", () => {
    expect(mongoCheckNames(checks)).toEqual(["a-check", "b-check"]);
  });

  it("lists the real registry by default", () => {
    expect(mongoCheckNames()).toContain("seed-unchanged");
  });

  it("lists nothing for an empty registry", () => {
    expect(mongoCheckNames({})).toEqual([]);
  });
});

describe("assertMongoCheckExists", () => {
  it("accepts a registered name", () => {
    expect(() => assertMongoCheckExists("a-check", checks)).not.toThrow();
  });

  it("accepts a name in the real registry by default", () => {
    expect(() => assertMongoCheckExists("seed-unchanged")).not.toThrow();
  });

  it.each(["nope", "../a-check", "", "constructor", "__proto__", "toString"])(
    "rejects %j and lists the choices",
    (name) => {
      expect(() => assertMongoCheckExists(name, checks)).toThrow(
        `unknown mongoCheck "${name}". Available: a-check, b-check`,
      );
    },
  );
});
