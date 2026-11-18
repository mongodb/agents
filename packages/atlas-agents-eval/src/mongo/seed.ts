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

import { BSON, MongoClient } from "mongodb";
import { z } from "zod";

const SYSTEM_DATABASES = new Set(["admin", "config", "local"]);

const CollectionSeedSchema = z.object({
  /**
   * Canonical Extended JSON, so `{"$oid": "..."}`, `{"$date": "..."}` and
   * `{"$numberLong": "..."}` keep their BSON types and values.
   */
  documents: z.array(z.record(z.string(), z.unknown())).default([]),
  indexes: z
    .array(
      z.object({
        key: z.record(
          z.string(),
          z.union([z.literal(1), z.literal(-1), z.string()]),
        ),
        name: z.string().optional(),
        unique: z.boolean().optional(),
      }),
    )
    .default([]),
});

/** `{ database: { collection: { documents, indexes } } }` */
export const MongoSeedSchema = z.record(
  z.string().refine((name) => !SYSTEM_DATABASES.has(name), {
    message: "Seed data cannot target admin, config, or local",
  }),
  z.record(z.string(), CollectionSeedSchema),
);

export type MongoSeed = z.output<typeof MongoSeedSchema>;
export type MongoSeedInput = z.input<typeof MongoSeedSchema>;

/**
 * Documents, keyed by database then collection, as relaxed Extended JSON so
 * numbers stay plain JSON numbers (`10`, not `{"$numberInt": "10"}`) for
 * scorer path assertions.
 */
export type MongoDump = Record<string, Record<string, unknown[]>>;

export async function seedMongo(uri: string, seed: MongoSeed): Promise<void> {
  const client = new MongoClient(uri);
  try {
    for (const [dbName, collections] of Object.entries(seed)) {
      for (const [name, { documents, indexes }] of Object.entries(
        collections,
      )) {
        const collection = client.db(dbName).collection(name);
        if (documents.length) {
          await collection.insertMany(
            documents.map(
              (doc) =>
                BSON.EJSON.deserialize(doc, {
                  relaxed: false,
                }) as BSON.Document,
            ),
          );
        }
        for (const { key, name: indexName, unique } of indexes) {
          await collection.createIndex(key as never, {
            ...(indexName && { name: indexName }),
            ...(unique && { unique }),
          });
        }
        if (!documents.length && !indexes.length) {
          await client.db(dbName).createCollection(name);
        }
      }
    }
  } finally {
    await client.close();
  }
}

/** Every document in every user collection, for scorers to inspect. */
export async function dumpMongo(uri: string): Promise<MongoDump> {
  const client = new MongoClient(uri);
  try {
    return await dumpMongoWith(client);
  } finally {
    await client.close();
  }
}

/** `dumpMongo` over a client the caller already has. */
export async function dumpMongoWith(client: MongoClient): Promise<MongoDump> {
  const dump: MongoDump = {};
  const { databases } = await client.db().admin().listDatabases();
  for (const { name: dbName } of databases) {
    if (SYSTEM_DATABASES.has(dbName)) continue;
    const db = client.db(dbName);
    dump[dbName] = {};
    for (const { name } of await db.listCollections().toArray()) {
      const docs = await db.collection(name).find().toArray();
      dump[dbName][name] = docs.map((doc) =>
        BSON.EJSON.serialize(doc, { relaxed: true }),
      );
    }
  }
  return dump;
}

/** The dump a database holds right after `seedMongo(seed)`. */
export function seedAsDump(seed: MongoSeed): MongoDump {
  const dump: MongoDump = {};
  for (const [dbName, collections] of Object.entries(seed)) {
    dump[dbName] = {};
    for (const [name, { documents }] of Object.entries(collections)) {
      dump[dbName][name] = documents.map((doc) =>
        BSON.EJSON.serialize(
          BSON.EJSON.deserialize(doc, { relaxed: false }) as BSON.Document,
          { relaxed: true },
        ),
      );
    }
  }
  return dump;
}
