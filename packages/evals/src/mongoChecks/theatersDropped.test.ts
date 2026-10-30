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

import { theatersDropped } from "./theatersDropped.js";
import { startSampleMflixDb, type SampleMflixDb } from "./sampleMflixTestDb.js";

describe("theatersDropped", () => {
  let mflix: SampleMflixDb;
  const flix = () => mflix.db("sample_mflix");
  const movies = () => flix().collection("movies");
  const run = () => mflix.run(theatersDropped);

  beforeAll(async () => {
    mflix = await startSampleMflixDb();
  }, 120_000);
  beforeEach(() => mflix.reset());
  afterAll(() => mflix?.close());

  it("fails on the database as seeded", async () => {
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });

  it("passes when the theaters collection is dropped", async () => {
    await flix().collection("theaters").drop();
    await expect(run()).resolves.toBeUndefined();
  });

  it("fails when a movie went too", async () => {
    await flix().collection("theaters").drop();
    await movies().deleteOne({});
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });

  it("fails when theaters was emptied but not dropped", async () => {
    await flix().collection("theaters").deleteMany({});
    await expect(run()).rejects.toBeInstanceOf(AssertionError);
  });
});
