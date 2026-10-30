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

import { MONGO_CHECKS } from "./registry.js";

describe("MONGO_CHECKS", () => {
  it("registers seed-unchanged", () => {
    expect(MONGO_CHECKS).toHaveProperty("seed-unchanged");
  });

  it.each(Object.entries(MONGO_CHECKS))("%s is a function", (_name, check) => {
    expect(check).toBeTypeOf("function");
  });

  it("names every check in lowercase kebab-case, as a dataset writes it", () => {
    for (const name of Object.keys(MONGO_CHECKS)) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
