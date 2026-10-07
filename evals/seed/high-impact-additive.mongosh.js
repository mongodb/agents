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

// Additive Q2 fixtures matching the repository's highImpact seed scenarios.
// Inserts missing eval-owned IDs only. Never drops/deletes data or changes profiling.
//   node src/seed.ts --apply (runs this against SEED_EXPECTED_HOST)

const seedDb = db.getSiblingDB("highImpact");
const SEED_ID = "eval-v1";
const scenarios = [
  { name: "dbA", field: "status", common: "active", rare: "archived", commonCount: 2_000, rareCount: 5, padSize: 85_000 },
  { name: "dbB", field: "type", common: "bulk", rare: "premium", commonCount: 15_000, rareCount: 10, padSize: 9_500 },
  { name: "dbC", field: "priority", common: 1, rare: 10, commonCount: 600, rareCount: 3, padSize: 200_000 },
  { name: "dbD", field: "category", common: "standard", rare: "special", commonCount: 3_000, rareCount: 5, padSize: 56_000 },
];

for (const scenario of scenarios) {
  const collection = seedDb.getCollection(scenario.name);
  const total = scenario.commonCount + scenario.rareCount;
  const pad = "x".repeat(scenario.padSize);
  for (let start = 0; start < total; start += 100) {
    collection.bulkWrite(Array.from({ length: Math.min(100, total - start) }, (_, i) => {
      const n = start + i;
      return { updateOne: {
        filter: { _id: `${SEED_ID}/${scenario.name}/${n}` },
        update: { $setOnInsert: {
          evalSeed: SEED_ID,
          [scenario.field]: n < scenario.commonCount ? scenario.common : scenario.rare,
          n,
          pad,
        } },
        upsert: true,
      } };
    }));
  }
  print(`${scenario.name}: ${collection.countDocuments({ evalSeed: SEED_ID })} eval documents; existing data preserved.`);
}

for (let iteration = 0; iteration < 20; iteration++) {
  for (const scenario of scenarios) {
    seedDb.getCollection(scenario.name)
      .find({ [scenario.field]: scenario.rare })
      .hint({ $natural: 1 })
      .maxTimeMS(60_000)
      .comment(`${SEED_ID}/Q2/${scenario.name}`)
      .toArray();
  }
  if (iteration % 5 === 0) print(`Slow-query scans: ${iteration + 1}/20 rounds.`);
}
print("Additive Q2 seed complete. Performance Advisor visibility must be checked separately.");
