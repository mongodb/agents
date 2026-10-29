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

import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures.js";
import { startEphemeralMongo, type EphemeralMongo } from "../mongo/ephemeralMongo.js";
import { MongoSeedSchema, type MongoSeed } from "../mongo/seed.js";
import { seedUnchanged } from "./seedUnchanged.js";

describe("seedUnchanged", () => {
  const seed: MongoSeed = MongoSeedSchema.parse(
    loadFixture("localMongo", "sample-mflix"),
  );
  let mongo: EphemeralMongo;
  let client: MongoClient;

  beforeAll(async () => {
    mongo = await startEphemeralMongo(seed);
    client = new MongoClient(mongo.uri);
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await mongo?.stop();
  });

  const movies = () => client.db("sample_mflix").collection("movies");
  const run = () => seedUnchanged({ client, seed, baselineDbHashes: mongo.baselineDbHashes });

  async function undoAfter(change: () => Promise<unknown>, undo: () => Promise<unknown>) {
    await change();
    try {
      await expect(run()).rejects.toBeInstanceOf(AssertionError);
    } finally {
      await undo();
    }
  }

  it("passes on the database as seeded", async () => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("fails when a document is deleted", async () => {
    const doc = await movies().findOne({ _id: 1 as never });
    await undoAfter(
      () => movies().deleteOne({ _id: 1 as never }),
      () => movies().insertOne(doc!),
    );
    await expect(run()).resolves.toBeUndefined();
  });

  it("fails when a document is inserted", async () => {
    await undoAfter(
      () => movies().insertOne({ _id: 99 as never, title: "Extra" }),
      () => movies().deleteOne({ _id: 99 as never }),
    );
  });

  it("fails when a field changes", async () => {
    await undoAfter(
      () => movies().updateOne({ _id: 1 as never }, { $set: { year: 2000 } }),
      () => movies().updateOne({ _id: 1 as never }, { $set: { year: 1986 } }),
    );
  });

  it("fails when a collection is added", async () => {
    const extra = client.db("sample_mflix").collection("copy");
    await undoAfter(
      () => extra.insertOne({ _id: 1 as never }),
      () => extra.drop(),
    );
  });

  it("fails when a collection is dropped", async () => {
    const theaters = client.db("sample_mflix").collection("theaters");
    const docs = await theaters.find().toArray();
    await undoAfter(
      () => theaters.drop(),
      () => theaters.insertMany(docs),
    );
  });

  it("names the collection that changed", async () => {
    await movies().updateOne({ _id: 1 as never }, { $set: { year: 2000 } });
    try {
      await expect(run()).rejects.toThrow(/sample_mflix\.movies changed/);
    } finally {
      await movies().updateOne({ _id: 1 as never }, { $set: { year: 1986 } });
    }
  });

  it("names a collection that was added or dropped", async () => {
    const extra = client.db("sample_mflix").collection("copy");
    await extra.insertOne({ _id: 1 as never });
    await expect(run()).rejects.toThrow(/sample_mflix\.copy was added/);
    await extra.drop();
    const theaters = client.db("sample_mflix").collection("theaters");
    const docs = await theaters.find().toArray();
    await theaters.drop();
    try {
      await expect(run()).rejects.toThrow(/sample_mflix\.theaters was dropped/);
    } finally {
      await theaters.insertMany(docs);
    }
  });
});
