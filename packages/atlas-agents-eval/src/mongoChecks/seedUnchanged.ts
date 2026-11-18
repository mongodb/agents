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

import { dbHashes, describeHashChanges } from "../mongo/dbHash.js";
import type { MongoCheck } from "./types.js";

/**
 * Every user collection is as seeded: nothing inserted, changed, deleted or
 * dropped, and no extra collection. The server hashes each collection, so
 * the check stays cheap on a large one. Indexes are not compared.
 */
export const seedUnchanged: MongoCheck = async ({ client, baselineDbHashes }) => {
  const changes = describeHashChanges(baselineDbHashes, await dbHashes(client));
  assert.equal(changes.length, 0, changes.join(", "));
};
