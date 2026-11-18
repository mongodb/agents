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

import { AssertionError } from "node:assert";

import { describe, expect, it } from "vitest";

import { MongoSeedSchema } from "../mongo/seed.js";
import {
  assertDumpsEqual,
  docsOf,
  normalizeDump,
  seedCopy,
} from "./expectedDump.js";

const seed = MongoSeedSchema.parse({
  shop: {
    orders: { documents: [{ _id: 2, qty: 5 }, { _id: 1, qty: 3 }] },
  },
});

describe("normalizeDump", () => {
  it("sorts each collection by _id", () => {
    const dump = { shop: { orders: [{ _id: 2 }, { _id: 1 }, { _id: 10 }] } };

    const ids = normalizeDump(dump).shop!.orders!.map((d) => (d as { _id: number })._id);

    expect(ids).toEqual([1, 10, 2]);
  });

  it("does not change the dump it was given", () => {
    const dump = { shop: { orders: [{ _id: 2 }, { _id: 1 }] } };

    normalizeDump(dump);

    expect(dump.shop.orders).toEqual([{ _id: 2 }, { _id: 1 }]);
  });
});

describe("seedCopy", () => {
  it("is the seed as plain documents", () => {
    expect(seedCopy(seed)).toEqual({
      shop: { orders: [{ _id: 2, qty: 5 }, { _id: 1, qty: 3 }] },
    });
  });

  it("returns a copy a check can edit without touching the seed", () => {
    const copy = seedCopy(seed);
    docsOf(copy, "shop", "orders")[0]!.qty = 99;

    expect(seedCopy(seed).shop!.orders![0]).toEqual({ _id: 2, qty: 5 });
  });
});

describe("assertDumpsEqual", () => {
  const dump = { shop: { orders: [{ _id: 1, qty: 3 }, { _id: 2, qty: 5 }] } };

  it("accepts the same documents in another order", () => {
    const reordered = { shop: { orders: [{ _id: 2, qty: 5 }, { _id: 1, qty: 3 }] } };

    expect(() => assertDumpsEqual(reordered, dump)).not.toThrow();
  });

  it.each([
    ["a changed field", { shop: { orders: [{ _id: 1, qty: 4 }, { _id: 2, qty: 5 }] } }],
    ["a missing document", { shop: { orders: [{ _id: 1, qty: 3 }] } }],
    ["an extra collection", { ...dump, extra: { c: [] } }],
    ["a missing collection", { shop: {} }],
  ])("rejects %s", (_name, other) => {
    expect(() => assertDumpsEqual(other, dump)).toThrow(AssertionError);
  });
});

describe("docsOf", () => {
  const dump = { shop: { orders: [{ _id: 1 }] } };

  it("returns a collection's documents", () => {
    expect(docsOf(dump, "shop", "orders")).toEqual([{ _id: 1 }]);
  });

  it("returns none for an unknown database or collection", () => {
    expect(docsOf(dump, "nope", "orders")).toEqual([]);
    expect(docsOf(dump, "shop", "nope")).toEqual([]);
  });
});
