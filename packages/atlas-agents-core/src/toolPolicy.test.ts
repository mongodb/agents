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

import { selectTools, writeOperationsAllowed } from "./toolPolicy.js";

const allowlist = new Set(["mongodb__find", "mongodb__aggregate"]);

describe("writeOperationsAllowed", () => {
  it("treats unset, empty, and false values as disabled", () => {
    expect(writeOperationsAllowed({})).toBe(false);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "" })).toBe(false);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "   " })).toBe(
      false,
    );
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "false" })).toBe(
      false,
    );
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: " FALSE " })).toBe(
      false,
    );
  });

  it("treats other non-empty values as enabled", () => {
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "1" })).toBe(true);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "true" })).toBe(
      true,
    );
  });
});

describe("selectTools", () => {
  const discovered = [
    { name: "mongodb__find" },
    { name: "mongodb__aggregate" },
    { name: "mongodb__insert_many" },
  ];

  it("keeps only the allowlist when writes are disabled", () => {
    expect(selectTools(discovered, allowlist, false)).toEqual([
      { name: "mongodb__find" },
      { name: "mongodb__aggregate" },
    ]);
  });

  it("keeps every tool when writes are enabled", () => {
    expect(selectTools(discovered, allowlist, true)).toEqual(discovered);
  });
});
