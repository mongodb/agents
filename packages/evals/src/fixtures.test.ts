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

import { afterAll, describe, expect, it } from "vitest";

import { tempFixtureStore } from "./testSupport/tempFixtureStore.js";

const store = tempFixtureStore({
  atlas: { "one-project": { orgs: [{ id: "o", name: "Acme" }] } },
  mongo: { "shop-orders": { shop: { orders: [{ _id: 1 }] } } },
});
afterAll(() => store.remove());

describe("names", () => {
  it("lists each kind's fixtures, sorted", () => {
    expect(store.names("mockAtlas")).toEqual(["one-project"]);
    expect(store.names("localMongo")).toEqual(["shop-orders"]);
  });

  it("lists nothing for a kind with no directory", () => {
    const empty = tempFixtureStore({});
    try {
      expect(empty.names("mockAtlas")).toEqual([]);
    } finally {
      empty.remove();
    }
  });
});

describe("load", () => {
  it("returns a fresh copy each time", () => {
    const first = store.load("localMongo", "shop-orders") as Record<string, unknown>;
    delete first.shop;
    expect(store.load("localMongo", "shop-orders")).toHaveProperty("shop");
  });

  it("names the available fixtures when one is unknown", () => {
    expect(() => store.assertExists("mockAtlas", "nope")).toThrow(
      /unknown mockAtlas fixture "nope". Available: one-project/,
    );
  });

  it.each(["../fixtures", "a/b", ""])("rejects the path-like name %j", (name) => {
    expect(() => store.assertExists("mockAtlas", name)).toThrow(/unknown/);
  });
});

describe("resolveToolSetup", () => {
  it("swaps names for data and leaves absent fields out", () => {
    const resolved = store.resolveToolSetup({ mockAtlas: "one-project" });
    expect(resolved).toEqual({ mockAtlas: store.load("mockAtlas", "one-project") });
    expect(resolved).not.toHaveProperty("localMongo");
  });

  it("resolves to an empty setup for a case with none", () => {
    expect(store.resolveToolSetup(undefined)).toEqual({});
  });
});
