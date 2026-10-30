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

import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dbHashes, describeHashChanges } from "./dbHash.js";
import { startEphemeralMongo, type EphemeralMongo } from "./ephemeralMongo.js";
import { MongoSeedSchema } from "./seed.js";

type Doc = { _id: number; [field: string]: unknown };

describe("describeHashChanges", () => {
  const before = { shop: { orders: "a", items: "b" }, blog: { posts: "c" } };

  it("reports nothing for equal hashes", () => {
    expect(describeHashChanges(before, structuredClone(before))).toEqual([]);
  });

  it("reports nothing when both sides are empty", () => {
    expect(describeHashChanges({}, {})).toEqual([]);
  });

  it("names a collection whose hash changed", () => {
    const after = { ...before, shop: { ...before.shop, orders: "z" } };

    expect(describeHashChanges(before, after)).toEqual(["shop.orders changed"]);
  });

  it("names a dropped collection", () => {
    const after = { ...before, shop: { orders: "a" } };

    expect(describeHashChanges(before, after)).toEqual(["shop.items was dropped"]);
  });

  it("names an added collection, in a known or a new database", () => {
    const after = {
      ...before,
      shop: { ...before.shop, extra: "d" },
      other: { stuff: "e" },
    };

    expect(describeHashChanges(before, after)).toEqual([
      "shop.extra was added",
      "other.stuff was added",
    ]);
  });

  it("names every collection of a dropped database", () => {
    const { blog: _blog, ...after } = before;

    expect(describeHashChanges(before, after)).toEqual(["blog.posts was dropped"]);
  });

  it("lists several differences together", () => {
    const after = { shop: { orders: "z" }, blog: { posts: "c", tags: "t" } };

    expect(describeHashChanges(before, after)).toEqual([
      "shop.orders changed",
      "shop.items was dropped",
      "blog.tags was added",
    ]);
  });
});

describe("dbHashes", () => {
  let mongo: EphemeralMongo;
  let client: MongoClient;

  beforeAll(async () => {
    mongo = await startEphemeralMongo(
      MongoSeedSchema.parse({
        shop: { orders: { documents: [{ _id: 1, qty: 1 }, { _id: 2, qty: 2 }] } },
        blog: { posts: { documents: [{ _id: 1, title: "hi" }] } },
      }),
    );
    client = new MongoClient(mongo.uri);
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await mongo?.stop();
  });

  const orders = () => client.db("shop").collection<Doc>("orders");

  it("hashes each user collection of each user database", async () => {
    const hashes = await dbHashes(client);

    expect(Object.keys(hashes).sort()).toEqual(["blog", "shop"]);
    expect(Object.keys(hashes.shop!)).toEqual(["orders"]);
    expect(hashes.shop!.orders).toMatch(/^[0-9a-f]{32}$/);
  });

  it("skips the system databases and system collections", async () => {
    const db = client.db("shop");
    await db.createCollection("events", { capped: true, size: 4096 });
    await db.createCollection("by_year", {
      viewOn: "orders",
      pipeline: [{ $match: {} }],
    });
    try {
      const hashes = await dbHashes(client);

      expect(Object.keys(hashes)).not.toEqual(
        expect.arrayContaining(["admin", "config", "local"]),
      );
      expect(Object.keys(hashes.shop!).some((n) => n.startsWith("system."))).toBe(
        false,
      );
    } finally {
      await db.dropCollection("by_year");
      await db.dropCollection("events");
    }
  });

  it("is stable when nothing changes", async () => {
    expect(await dbHashes(client)).toEqual(await dbHashes(client));
  });

  it("changes when a document is updated, inserted or deleted", async () => {
    const original = await dbHashes(client);
    const hashOfOrders = async () => (await dbHashes(client)).shop!.orders;

    await orders().updateOne({ _id: 1 }, { $set: { qty: 9 } });
    const updated = await hashOfOrders();
    await orders().updateOne({ _id: 1 }, { $set: { qty: 1 } });
    expect(await hashOfOrders()).toBe(original.shop!.orders);

    await orders().insertOne({ _id: 3 });
    const inserted = await hashOfOrders();
    await orders().deleteOne({ _id: 3 });
    expect(await hashOfOrders()).toBe(original.shop!.orders);

    await orders().deleteOne({ _id: 2 });
    const deleted = await hashOfOrders();
    await orders().insertOne({ _id: 2, qty: 2 });

    expect(new Set([original.shop!.orders, updated, inserted, deleted]).size).toBe(4);
  });

  it("does not change when the other collections are untouched", async () => {
    const before = await dbHashes(client);
    await orders().updateOne({ _id: 1 }, { $set: { qty: 9 } });
    try {
      const after = await dbHashes(client);

      expect(after.blog).toEqual(before.blog);
    } finally {
      await orders().updateOne({ _id: 1 }, { $set: { qty: 1 } });
    }
  });

  it("is the same whatever order the documents were inserted in", async () => {
    const db = client.db("shop");
    await db.collection<Doc>("a").insertMany([{ _id: 1 }, { _id: 2 }]);
    await db.collection<Doc>("b").insertMany([{ _id: 2 }, { _id: 1 }]);
    try {
      const hashes = await dbHashes(client);

      expect(hashes.shop!.a).toBe(hashes.shop!.b);
    } finally {
      await db.dropCollection("a");
      await db.dropCollection("b");
    }
  });

  it("does not cover indexes", async () => {
    const before = await dbHashes(client);
    await orders().createIndex({ qty: 1 });
    try {
      expect(await dbHashes(client)).toEqual(before);
    } finally {
      await orders().dropIndex("qty_1");
    }
  });

  it("sees a dropped collection and a dropped database", async () => {
    const extra = client.db("scratch");
    await extra.collection<Doc>("tmp").insertOne({ _id: 1 });
    expect((await dbHashes(client)).scratch).toHaveProperty("tmp");

    await extra.dropCollection("tmp");
    expect((await dbHashes(client)).scratch?.tmp).toBeUndefined();

    await extra.dropDatabase();
    expect((await dbHashes(client)).scratch).toBeUndefined();
  });
});
