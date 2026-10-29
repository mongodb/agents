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
import { afterEach, describe, expect, it } from "vitest";

import { dbHashes } from "./dbHash.js";
import { startEphemeralMongo, type EphemeralMongo } from "./ephemeralMongo.js";
import { MongoSeedSchema } from "./seed.js";

const seed = MongoSeedSchema.parse({
  shop: {
    orders: { documents: [{ _id: 1, qty: 1 }, { _id: 2, qty: 2 }] },
    items: { documents: [{ _id: 1, name: "pen" }] },
  },
  blog: { posts: { documents: [{ _id: 1, title: "hi" }] } },
});

type Doc = { _id: number; [field: string]: unknown };

const started: EphemeralMongo[] = [];

async function start(): Promise<EphemeralMongo> {
  const mongo = await startEphemeralMongo(seed);
  started.push(mongo);
  return mongo;
}

async function withClient<T>(
  uri: string,
  fn: (client: MongoClient) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(uri);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((mongo) => mongo.stop()));
});

describe("startEphemeralMongo", () => {
  it("serves the seed on a connectable uri", async () => {
    const mongo = await start();

    const orders = await withClient(mongo.uri, (client) =>
      client.db("shop").collection<Doc>("orders").countDocuments(),
    );

    expect(orders).toBe(2);
  }, 120_000);

  it("takes baselineDbHashes of exactly the seeded collections", async () => {
    const mongo = await start();

    expect(Object.keys(mongo.baselineDbHashes).sort()).toEqual(["blog", "shop"]);
    expect(Object.keys(mongo.baselineDbHashes.shop!).sort()).toEqual([
      "items",
      "orders",
    ]);
    expect(Object.keys(mongo.baselineDbHashes.blog!)).toEqual(["posts"]);
  }, 120_000);

  it("keeps baselineDbHashes equal to the hashes of the untouched database", async () => {
    const mongo = await start();

    const now = await withClient(mongo.uri, dbHashes);

    expect(now).toEqual(mongo.baselineDbHashes);
  }, 120_000);

  it("does not update baselineDbHashes when the data changes", async () => {
    const mongo = await start();
    const baseline = structuredClone(mongo.baselineDbHashes);

    const now = await withClient(mongo.uri, async (client) => {
      await client.db("shop").collection<Doc>("orders").deleteOne({ _id: 1 });
      return dbHashes(client);
    });

    expect(mongo.baselineDbHashes).toEqual(baseline);
    expect(now.shop!.orders).not.toBe(baseline.shop!.orders);
    expect(now.shop!.items).toBe(baseline.shop!.items);
  }, 120_000);

  it("gives each instance its own database and baselineDbHashes", async () => {
    const [first, second] = [await start(), await start()];
    await withClient(first.uri, (client) =>
      client.db("shop").collection<Doc>("orders").deleteMany({}),
    );

    const untouched = await withClient(second.uri, (client) =>
      client.db("shop").collection<Doc>("orders").countDocuments(),
    );

    expect(first.uri).not.toBe(second.uri);
    expect(untouched).toBe(2);
    expect(second.baselineDbHashes).toEqual(first.baselineDbHashes);
  }, 120_000);

  it("dumps the seeded documents", async () => {
    const mongo = await start();

    const dump = await mongo.dump();

    expect(dump.shop!.orders).toHaveLength(2);
    expect(dump.blog!.posts).toEqual([{ _id: 1, title: "hi" }]);
  }, 120_000);

  it("stops the server", async () => {
    const mongo = await start();
    await mongo.stop();
    started.pop();

    const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 500 });
    try {
      await expect(client.db("shop").command({ ping: 1 })).rejects.toThrow();
    } finally {
      await client.close();
    }
  }, 120_000);
});
