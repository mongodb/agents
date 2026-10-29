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

import { allRatingsSetToTen } from "./allRatingsSetToTen.js";
import { moviesBefore1950CopiedToClassicMovies } from "./moviesBefore1950CopiedToClassicMovies.js";
import { moviesBefore1950Deleted } from "./moviesBefore1950Deleted.js";
import { myHomeMovieInserted } from "./myHomeMovieInserted.js";
import { seedUnchanged } from "./seedUnchanged.js";
import { theatersDropped } from "./theatersDropped.js";
import type { MongoCheck } from "./types.js";

/**
 * Every check a case can name in `input.custom.mongoCheck`. A static map, not
 * a lookup on a path, so checks are typechecked and a dataset can only select
 * code that is in this repo.
 */
export const MONGO_CHECKS: Readonly<Record<string, MongoCheck>> = {
  "all-ratings-set-to-ten": allRatingsSetToTen,
  "movies-before-1950-copied-to-classic-movies": moviesBefore1950CopiedToClassicMovies,
  "movies-before-1950-deleted": moviesBefore1950Deleted,
  "my-home-movie-inserted": myHomeMovieInserted,
  "seed-unchanged": seedUnchanged,
  "theaters-dropped": theatersDropped,
};
