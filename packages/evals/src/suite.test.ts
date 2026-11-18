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

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AtlasFixtureSchema } from "./atlas/fixtures.js";
import { MONGO_CHECKS } from "./mongoChecks/registry.js";
import { MongoSeedSchema } from "./mongo/seed.js";
import { DATASET_DIR, FIXTURES, loadCases } from "./suite.js";

describe("shipped fixtures", () => {
  it.each(FIXTURES.names("mockAtlas"))("atlas/%s is a valid account", (name) => {
    expect(() => AtlasFixtureSchema.parse(FIXTURES.load("mockAtlas", name))).not.toThrow();
  });

  it.each(FIXTURES.names("localMongo"))("mongo/%s is a valid seed", (name) => {
    expect(() => MongoSeedSchema.parse(FIXTURES.load("localMongo", name))).not.toThrow();
  });
});

describe("MONGO_CHECKS", () => {
  it("registers seed-unchanged", () => {
    expect(MONGO_CHECKS).toHaveProperty("seed-unchanged");
  });
});

describe("shipped datasets", () => {
  const files = fs
    .readdirSync(DATASET_DIR)
    .filter((file) => file.endsWith(".yml"));

  it("has at least one dataset", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses and names only known tools", (file) => {
    const cases = loadCases(path.join(DATASET_DIR, file));
    expect(cases.length).toBeGreaterThan(0);
    for (const testCase of cases) expect(testCase.name).toBeTruthy();
  });
});
