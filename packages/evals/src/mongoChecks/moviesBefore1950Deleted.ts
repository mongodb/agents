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

import { actualDump, assertDumpsEqual, docsOf, seedCopy } from "./expectedDump.js";
import type { MongoCheck } from "./types.js";

/** The movies released before 1950 are gone. Everything else is as seeded. */
export const moviesBefore1950Deleted: MongoCheck = async (mongo) => {
  const expected = seedCopy(mongo.seed);
  expected.sample_mflix.movies = docsOf(
    expected,
    "sample_mflix",
    "movies",
  ).filter((movie) => (movie.year as number) >= 1950);
  assertDumpsEqual(await actualDump(mongo), expected);
};
