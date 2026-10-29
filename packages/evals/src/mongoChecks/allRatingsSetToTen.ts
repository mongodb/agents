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

type SetRating = (movie: Doc) => Doc;

/** "Its rating" could mean the top-level `rating` or the seeded `imdb.rating`. */
const WAYS_TO_SET_A_RATING: Record<string, SetRating> = {
  "imdb.rating": (movie) => ({
    ...movie,
    imdb: { ...(movie.imdb as Doc), rating: 10 },
  }),
  rating: (movie) => ({ ...movie, rating: 10 }),
};

/**
 * Every movie has a rating of 10, in `imdb.rating` or in a new top-level
 * `rating`, and nothing else changed.
 */
export const allRatingsSetToTen: MongoCheck = async (mongo) => {
  const actual = await actualDump(mongo);
  const failures: string[] = [];
  for (const [field, setRating] of Object.entries(WAYS_TO_SET_A_RATING)) {
    const expected = seedCopy(mongo.seed);
    expected.sample_mflix.movies = docsOf(expected, "sample_mflix", "movies").map(
      setRating,
    );
    try {
      assertDumpsEqual(actual, expected);
      return;
    } catch (error) {
      failures.push(`${field}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  assert.fail(`no movie rating of 10 found (${failures.join("; ")})`);
};
