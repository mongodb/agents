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

import { moviesBefore1950Deleted } from "./moviesBefore1950Deleted.js";
import { startSampleMflixDb, type SampleMflixDb } from "./sampleMflixTestDb.js";

describe("moviesBefore1950Deleted", () => {
  let mflix: SampleMflixDb;
  const flix = () => mflix.db("sample_mflix");
  const movies = () => flix().collection("movies");
  const run = () => mflix.run(moviesBefore1950Deleted);

  beforeAll(async () => {
    mflix = await startSampleMflixDb();
  }, 120_000);
  beforeEach(() => mflix.reset());
  afterAll(() => mflix?.close());

  it("fails on the database as seeded", async () => {
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });

  it("passes when the movies before 1950 are deleted", async () => {
    await movies().deleteMany({ year: { $lt: 1950 } });
    await expect(run()).resolves.toBeUndefined();
  });

  it("fails when other movies were deleted too", async () => {
    await movies().deleteMany({ year: { $lt: 2000 } });
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });

  it("fails when a remaining movie changed", async () => {
    await movies().deleteMany({ year: { $lt: 1950 } });
    await movies().updateOne({ year: { $gte: 1950 } }, { $set: { year: 3000 } });
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });
});
