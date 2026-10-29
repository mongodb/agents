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

import { dumpMongoWith, seedAsDump, type MongoDump } from "../mongo/seed.js";
import type { MongoAccess } from "../tools/types.js";

export type Doc = Record<string, unknown>;

/** Sorts by `_id`, so the order the database returns does not matter. */
function byId(docs: unknown[]): unknown[] {
  const key = (doc: unknown) => JSON.stringify((doc as { _id?: unknown })._id);
  return [...docs].sort((a, b) => key(a).localeCompare(key(b)));
}

export function normalizeDump(dump: MongoDump): MongoDump {
  return Object.fromEntries(
    Object.entries(dump).map(([db, collections]) => [
      db,
      Object.fromEntries(
        Object.entries(collections).map(([name, docs]) => [name, byId(docs)]),
      ),
    ]),
  );
}

/** A copy of the seed as a dump, for a check to edit into the expected end state. */
export function seedCopy(seed: MongoAccess["seed"]): MongoDump {
  return structuredClone(seedAsDump(seed));
}

export async function actualDump(mongo: MongoAccess): Promise<MongoDump> {
  return dumpMongoWith(mongo.client);
}

export function assertDumpsEqual(actual: MongoDump, expected: MongoDump): void {
  assert.deepEqual(normalizeDump(actual), normalizeDump(expected));
}

export function docsOf(dump: MongoDump, db: string, collection: string): Doc[] {
  return (dump[db]?.[collection] ?? []) as Doc[];
}
