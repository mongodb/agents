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

import assert from "node:assert/strict";

import {
  actualDump,
  assertDumpsEqual,
  docsOf,
  seedCopy,
  type Doc,
} from "./expectedDump.js";
import type { MongoCheck } from "./types.js";

/**
 * One new movie titled "My Home Movie" is in the movies collection. Every
 * seeded document is untouched.
 */
export const myHomeMovieInserted: MongoCheck = async (mongo) => {
  const expected = seedCopy(mongo.seed);
  const seededIds = new Set(
    docsOf(expected, "sample_mflix", "movies").map((m) => JSON.stringify(m._id)),
  );
  const actual = await actualDump(mongo);
  const movies = docsOf(actual, "sample_mflix", "movies");
  const added = movies.filter((m) => !seededIds.has(JSON.stringify(m._id)));
  assert.equal(added.length, 1, `wanted 1 new movie, found ${added.length}`);
  assert.equal(added[0]?.title, "My Home Movie");

  actual.sample_mflix.movies = movies.filter((m: Doc) => !added.includes(m));
  assertDumpsEqual(actual, expected);
};
