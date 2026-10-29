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

import { loadFixture } from "../fixtures.js";
import { startEphemeralMongo, type EphemeralMongo } from "./ephemeralMongo.js";
import { MongoSeedSchema } from "./seed.js";

let mongo: EphemeralMongo;

beforeAll(async () => {
  mongo = await startEphemeralMongo(
    MongoSeedSchema.parse(loadFixture("localMongo", "sample-mflix")),
  );
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

describe("sample-mflix fixture", () => {
  it("seeds 12 movies and 3 theaters", async () => {
    const dump = await mongo.dump();

    expect(dump.sample_mflix.movies).toHaveLength(12);
    expect(dump.sample_mflix.theaters).toHaveLength(3);
  });

  it("gives every document an integer _id, so a run can be compared to it", async () => {
    const dump = await mongo.dump();
    const ids = [
      ...dump.sample_mflix.movies,
      ...dump.sample_mflix.theaters,
    ].map((doc) => (doc as { _id: unknown })._id);

    expect(ids.every((id) => Number.isInteger(id))).toBe(true);
  });

  it("creates the source indexes, with a unique theaterId", async () => {
    const client = new MongoClient(mongo.uri);
    try {
      const db = client.db("sample_mflix");
      const movies = await db.collection("movies").indexes();
      const theaters = await db.collection("theaters").indexes();

      expect(movies.map((i) => i.key)).toEqual([
        { _id: 1 },
        { year: 1 },
        { "imdb.rating": -1 },
      ]);
      expect(theaters.find((i) => "theaterId" in i.key)?.unique).toBe(true);
    } finally {
      await client.close();
    }
  });
});
