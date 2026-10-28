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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startEphemeralMongo, type EphemeralMongo } from "./ephemeralMongo.js";
import { MongoSeedSchema } from "./seed.js";

const BIG = "9007199254740993";

let mongo: EphemeralMongo;

beforeAll(async () => {
  mongo = await startEphemeralMongo(
    MongoSeedSchema.parse({
      shop: {
        orders: {
          documents: [
            {
              _id: 1,
              big: { $numberLong: BIG },
              small: { $numberLong: "5" },
              plain: 7,
            },
          ],
        },
      },
    }),
  );
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

describe("seeded BSON types", () => {
  it("stores $numberLong as a Long with its exact value", async () => {
    const client = new MongoClient(mongo.uri, { promoteLongs: false });
    try {
      const doc = await client.db("shop").collection("orders").findOne();

      expect(doc?.big).toBeInstanceOf(BSON.Long);
      expect(doc?.big.toString()).toBe(BIG);
      expect(doc?.small).toBeInstanceOf(BSON.Long);
    } finally {
      await client.close();
    }
  });

  it("dumps 64-bit integers without losing value or type", async () => {
    const dump = await mongo.dump();

    expect(dump.shop.orders[0]).toMatchObject({
      big: { $numberLong: BIG },
      small: { $numberLong: "5" },
    });
  });
});
