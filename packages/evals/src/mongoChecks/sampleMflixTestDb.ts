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

import { loadFixture } from "../fixtures.js";
import {
  startEphemeralMongo,
  type EphemeralMongo,
} from "../mongo/ephemeralMongo.js";
import { MongoSeedSchema, seedMongo, type MongoSeed } from "../mongo/seed.js";
import type { MongoCheck } from "./types.js";

/** A real mongod holding `sample-mflix`, for a check's own test. */
export interface SampleMflixDb {
  readonly db: MongoClient["db"];
  /** Puts the seed back, whatever a test did. Call it before each test. */
  reset(): Promise<void>;
  /** Runs `check` the way the task does. */
  run(check: MongoCheck): Promise<void>;
  close(): Promise<void>;
}

export async function startSampleMflixDb(): Promise<SampleMflixDb> {
  const seed: MongoSeed = MongoSeedSchema.parse(
    loadFixture("localMongo", "sample-mflix"),
  );
  const mongo: EphemeralMongo = await startEphemeralMongo(seed);
  const client = new MongoClient(mongo.uri);
  return {
    db: (name) => client.db(name),
    async reset() {
      await client.db("sample_mflix").dropDatabase();
      await seedMongo(mongo.uri, seed);
    },
    run: (check) =>
      check({ client, seed, baselineDbHashes: mongo.baselineDbHashes }),
    async close() {
      await client.close();
      await mongo.stop();
    },
  };
}
