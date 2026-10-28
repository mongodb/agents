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

import { AtlasFixtureSchema } from "./atlas/fixtures.js";
import {
  assertFixtureExists,
  fixtureNames,
  loadFixture,
  resolveToolSetup,
} from "./fixtures.js";
import { MongoSeedSchema } from "./mongo/seed.js";

describe("shipped fixtures", () => {
  it.each(fixtureNames("mockAtlas"))("atlas/%s is a valid account", (name) => {
    expect(() => AtlasFixtureSchema.parse(loadFixture("mockAtlas", name))).not.toThrow();
  });

  it.each(fixtureNames("localMongo"))("mongo/%s is a valid seed", (name) => {
    expect(() => MongoSeedSchema.parse(loadFixture("localMongo", name))).not.toThrow();
  });
});

describe("loadFixture", () => {
  it("returns a fresh copy each time", () => {
    const first = loadFixture("localMongo", "shop-orders") as Record<string, unknown>;
    delete first.shop;
    expect(loadFixture("localMongo", "shop-orders")).toHaveProperty("shop");
  });

  it("names the available fixtures when one is unknown", () => {
    expect(() => assertFixtureExists("mockAtlas", "nope")).toThrow(
      /unknown mockAtlas fixture "nope". Available: .*one-project/,
    );
  });

  it.each(["../fixtures", "a/b", ""])("rejects the path-like name %j", (name) => {
    expect(() => assertFixtureExists("mockAtlas", name)).toThrow(/unknown/);
  });
});

describe("resolveToolSetup", () => {
  it("swaps names for data and leaves absent fields out", () => {
    const resolved = resolveToolSetup({ mockAtlas: "one-project" });
    expect(resolved).toEqual({ mockAtlas: loadFixture("mockAtlas", "one-project") });
    expect(resolved).not.toHaveProperty("localMongo");
  });

  it("resolves to an empty setup for a case with none", () => {
    expect(resolveToolSetup(undefined)).toEqual({});
  });
});
