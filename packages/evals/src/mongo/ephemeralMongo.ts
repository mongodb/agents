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

import { MongoMemoryServer } from "mongodb-memory-server-core";

import { dumpMongo, seedMongo, type MongoDump, type MongoSeed } from "./seed.js";

/** The mongod the harness downloads on first use, about 120 MB. */
const DEFAULT_MONGOD_VERSION = "8.2.6";

export interface EphemeralMongo {
  readonly uri: string;
  dump(): Promise<MongoDump>;
  stop(): Promise<void>;
}

/** A throwaway standalone mongod holding `seed`. */
export async function startEphemeralMongo(
  seed: MongoSeed,
): Promise<EphemeralMongo> {
  const server = await MongoMemoryServer.create({
    binary: { version: process.env.MONGOMS_VERSION ?? DEFAULT_MONGOD_VERSION },
  });
  try {
    const uri = server.getUri();
    await seedMongo(uri, seed);
    return {
      uri,
      dump: () => dumpMongo(uri),
      stop: async () => void (await server.stop()),
    };
  } catch (error) {
    await server.stop();
    throw error;
  }
}
