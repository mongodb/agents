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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { myHomeMovieInserted } from "./myHomeMovieInserted.js";
import { startSampleMflixDb, type SampleMflixDb } from "./sampleMflixTestDb.js";

describe("myHomeMovieInserted", () => {
  let mflix: SampleMflixDb;
  const flix = () => mflix.db("sample_mflix");
  const movies = () => flix().collection("movies");
  const run = () => mflix.run(myHomeMovieInserted);

  beforeAll(async () => {
    mflix = await startSampleMflixDb();
  }, 120_000);
  beforeEach(() => mflix.reset());
  afterAll(() => mflix?.close());

  it("fails on the database as seeded", async () => {
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });

  it("passes when My Home Movie was inserted", async () => {
    await movies().insertOne({ title: "My Home Movie" });
    await expect(run()).resolves.toBeUndefined();
  });

  it("fails on a different title", async () => {
    await movies().insertOne({ title: "Other" });
    await expect(run()).rejects.toThrow(/My Home Movie/);
  });

  it("fails on a second new movie", async () => {
    await movies().insertMany([{ title: "My Home Movie" }, { title: "Other" }]);
    await expect(run()).rejects.toThrow(/wanted 1 new movie, found 2/);
  });

  it("fails when a seeded movie changed", async () => {
    await movies().insertOne({ title: "My Home Movie" });
    await movies().updateOne({ year: { $exists: true } }, { $set: { year: 3000 } });
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });
});
