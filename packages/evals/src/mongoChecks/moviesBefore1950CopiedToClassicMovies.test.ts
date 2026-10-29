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

import { moviesBefore1950CopiedToClassicMovies } from "./moviesBefore1950CopiedToClassicMovies.js";
import { startSampleMflixDb, type SampleMflixDb } from "./sampleMflixTestDb.js";

describe("moviesBefore1950CopiedToClassicMovies", () => {
  let mflix: SampleMflixDb;
  const flix = () => mflix.db("sample_mflix");
  const movies = () => flix().collection("movies");
  const classic = () => flix().collection("classic_movies");
  const run = () => mflix.run(moviesBefore1950CopiedToClassicMovies);

  beforeAll(async () => {
    mflix = await startSampleMflixDb();
  }, 120_000);
  beforeEach(() => mflix.reset());
  afterAll(() => mflix?.close());

  const copyMoviesBefore = async (year: number) =>
    classic().insertMany(await movies().find({ year: { $lt: year } }).toArray());

  it("fails on the database as seeded", async () => {
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });

  it("passes when classic_movies holds the movies before 1950", async () => {
    await copyMoviesBefore(1950);
    await expect(run()).resolves.toBeUndefined();
  });

  it("fails when classic_movies holds other movies too", async () => {
    await copyMoviesBefore(2000);
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });

  it("fails when classic_movies misses a movie before 1950", async () => {
    await copyMoviesBefore(1950);
    await classic().deleteOne({});
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });

  it("fails when the source movies were touched", async () => {
    await copyMoviesBefore(1950);
    await movies().deleteMany({ year: { $lt: 1950 } });
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });
});
