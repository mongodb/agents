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

// Ground truth for the Q1/Q4/Q5 judge rubrics. Read-only.
//   mongosh "$SEED_MONGODB_URI" --quiet --file seed/ground-truth.mongosh.js > ground-truth.json
// Prints exactly one JSON object; keys match `groundTruthKey` in src/cases.ts.

const mflix = db.getSiblingDB("sample_mflix");
const restaurants = db.getSiblingDB("sample_restaurants");

const collectionCounts = mflix
  .getCollectionNames()
  .filter((name) => !name.startsWith("system."))
  .map((name) => ({ name, documents: mflix.getCollection(name).estimatedDocumentCount() }))
  .sort((a, b) => b.documents - a.documents);

const movieFields = mflix.movies
  .aggregate([
    { $sample: { size: 500 } },
    { $project: { kv: { $objectToArray: "$$ROOT" } } },
    { $unwind: "$kv" },
    { $group: { _id: "$kv.k", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ])
  .toArray()
  .map((row) => row._id);

const rankedDirectors = mflix.movies
  .aggregate([
    { $unwind: "$directors" },
    { $group: { _id: "$directors", movies: { $sum: 1 } } },
    { $sort: { movies: -1, _id: 1 } },
  ])
  .toArray()
  .map((row) => ({ director: row._id, movies: row.movies }));

const cutoff = rankedDirectors[4]?.movies;
const topDirectors = {
  note: "The user did not specify tie-breaking. Any five correctly ranked directors are valid when all directors tied at the fifth-place cutoff are considered.",
  canonicalTopFive: rankedDirectors.slice(0, 5),
  tiedAtCutoff: rankedDirectors.filter((row) => row.movies === cutoff),
};

const truth = {
  movieCount: mflix.movies.countDocuments({}),
  commentsCount: mflix.comments.countDocuments({}),
  movieFields,
  moviesAfter2000: {
    note: "year is numeric for most documents; 'after 2000' is ambiguous, so both readings are given",
    yearGreaterThan2000: mflix.movies.countDocuments({ year: { $gt: 2000 } }),
    yearAtLeast2000: mflix.movies.countDocuments({ year: { $gte: 2000 } }),
  },
  topDirectors,
  movieIndexes: mflix.movies.getIndexes().map((index) => ({ name: index.name, key: index.key })),
  italianBrooklyn: restaurants.restaurants.countDocuments({ borough: "Brooklyn", cuisine: "Italian" }),
  largestMflixCollection: collectionCounts[0],
  mflixCollections: collectionCounts.map((row) => row.name).sort(),
  rRated1999: mflix.movies.countDocuments({ year: 1999, rated: "R" }),
};

print(JSON.stringify(truth, null, 2));
