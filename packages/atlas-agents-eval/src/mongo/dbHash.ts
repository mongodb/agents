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

import type { MongoClient } from "mongodb";

const SYSTEM_DATABASES = new Set(["admin", "config", "local"]);

/** `{ database: { collection: md5 } }`, as the server computes it. */
export type DbHashes = Record<string, Record<string, string>>;

/**
 * The server's `dbHash` of every user collection. The server reads the
 * documents, so none cross the wire and the cost does not grow the check's
 * memory with the collection. The hash covers document contents, not indexes.
 */
export async function dbHashes(client: MongoClient): Promise<DbHashes> {
  const hashes: DbHashes = {};
  const { databases } = await client.db().admin().listDatabases();
  for (const { name } of databases) {
    if (SYSTEM_DATABASES.has(name)) continue;
    const { collections } = (await client
      .db(name)
      .command({ dbHash: 1 })) as { collections: Record<string, string> };
    hashes[name] = Object.fromEntries(
      Object.entries(collections).filter(
        ([collection]) => !collection.startsWith("system."),
      ),
    );
  }
  return hashes;
}

/** Names the collections that differ, such as `sample_mflix.movies changed`. */
export function describeHashChanges(
  before: DbHashes,
  after: DbHashes,
): string[] {
  const changes: string[] = [];
  for (const db of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[db] ?? {};
    const now = after[db] ?? {};
    for (const collection of new Set([...Object.keys(was), ...Object.keys(now)])) {
      const name = `${db}.${collection}`;
      if (!(collection in now)) changes.push(`${name} was dropped`);
      else if (!(collection in was)) changes.push(`${name} was added`);
      else if (was[collection] !== now[collection]) changes.push(`${name} changed`);
    }
  }
  return changes;
}
