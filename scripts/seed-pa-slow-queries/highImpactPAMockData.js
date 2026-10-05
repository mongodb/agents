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

"use strict";

if (typeof disableTelemetry === "function") {
  disableTelemetry();
}

var _counter = 2;
var _increments = [1, 2, 3, 5, 7, 11];

function getRandomIntInclusive(min, max) {
  _counter += _increments[_counter % _increments.length];
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor((_counter % (max - min + 1)) + min);
}

function getLongString(length) {
  var s = String.fromCharCode(getRandomIntInclusive(65, 122));
  return s.repeat(length);
}

const highImpact = db.getSiblingDB("highImpact");
highImpact.dropDatabase();
try {
  highImpact.setProfilingLevel(0, 100);
} catch (e) {
  print(
    "Error during setProfilingLevel - assuming this is a serverless cluster:",
    e.message,
  );
}

// Scenario 1: Very large documents (100KB avg), moderate delta
// Target: 100KB * 2000 documents scanned = ~200MB impact
// Create 2000 documents with status: 'active', 5 with status: 'archived'
print("Creating collection dbA with very large documents...");
let docs = [];
const numActiveDocs = 2000;
for (let i = 0; i < numActiveDocs; i++) {
  docs.push({
    status: "active",
    userId: i,
    data1: getLongString(10000), // ~10KB
    data2: getLongString(10000), // ~10KB
    data3: getLongString(10000), // ~10KB
    data4: getLongString(10000), // ~10KB
    data5: getLongString(10000), // ~10KB
    data6: getLongString(10000), // ~10KB
    data7: getLongString(10000), // ~10KB
    data8: getLongString(10000), // ~10KB
    metadata: {
      created: new Date(),
      id: new ObjectId(),
      extra: getLongString(5000), // ~5KB
    },
  });
}
print("Inserting dbA active documents...");
highImpact.dbA.insertMany(docs);
print("Finished inserting dbA active documents");

docs = [];
const numArchivedDocs = 5;
for (let i = 0; i < numArchivedDocs; i++) {
  docs.push({
    status: "archived",
    userId: numActiveDocs + i,
    data1: getLongString(10000),
    data2: getLongString(10000),
    data3: getLongString(10000),
    data4: getLongString(10000),
    data5: getLongString(10000),
    data6: getLongString(10000),
    data7: getLongString(10000),
    data8: getLongString(10000),
    metadata: {
      created: new Date(),
      id: new ObjectId(),
      extra: getLongString(5000),
    },
  });
}
print("Inserting dbA archived documents...");
highImpact.dbA.insertMany(docs);
print("Finished inserting dbA archived documents");

// Scenario 2: Moderate documents (10KB avg), very large delta
// Target: 10KB * 15000 documents scanned = ~150MB impact
// Create 15000 documents with type: 'bulk', 10 with type: 'premium'
print("Creating collection dbB with moderate documents...");
docs = [];
const numBulkDocs = 15000;
for (let i = 0; i < numBulkDocs; i++) {
  docs.push({
    type: "bulk",
    recordId: i,
    payload: getLongString(8000), // ~8KB
    tags: [getLongString(500), getLongString(500), getLongString(500)], // ~1.5KB
    timestamp: new Date(),
    ref: new ObjectId(),
  });
}
print("Inserting dbB bulk documents...");
highImpact.dbB.insertMany(docs);
print("Finished inserting dbB bulk documents");

docs = [];
const numPremiumDocs = 10;
for (let i = 0; i < numPremiumDocs; i++) {
  docs.push({
    type: "premium",
    recordId: numBulkDocs + i,
    payload: getLongString(8000),
    tags: [getLongString(500), getLongString(500), getLongString(500)],
    timestamp: new Date(),
    ref: new ObjectId(),
  });
}
print("Inserting dbB premium documents...");
highImpact.dbB.insertMany(docs);
print("Finished inserting dbB premium documents");

// Scenario 3: Extremely large documents (200KB avg), small delta
// Target: 200KB * 600 documents scanned = ~120MB impact
// Create 600 documents with priority: 1, 3 with priority: 10
print("Creating collection dbC with extremely large documents...");
docs = [];
const numLowPriorityDocs = 600;
for (let i = 0; i < numLowPriorityDocs; i++) {
  docs.push({
    priority: 1,
    documentId: i,
    largeField1: getLongString(20000), // ~20KB
    largeField2: getLongString(20000), // ~20KB
    largeField3: getLongString(20000), // ~20KB
    largeField4: getLongString(20000), // ~20KB
    largeField5: getLongString(20000), // ~20KB
    largeField6: getLongString(20000), // ~20KB
    largeField7: getLongString(20000), // ~20KB
    largeField8: getLongString(20000), // ~20KB
    largeField9: getLongString(20000), // ~20KB
    largeField10: getLongString(20000), // ~20KB
    objectId: new ObjectId(),
    createdAt: new Date(),
  });
}
print("Inserting dbC low priority documents...");
highImpact.dbC.insertMany(docs);
print("Finished inserting dbC low priority documents");

docs = [];
const numHighPriorityDocs = 3;
for (let i = 0; i < numHighPriorityDocs; i++) {
  docs.push({
    priority: 10,
    documentId: numLowPriorityDocs + i,
    largeField1: getLongString(20000),
    largeField2: getLongString(20000),
    largeField3: getLongString(20000),
    largeField4: getLongString(20000),
    largeField5: getLongString(20000),
    largeField6: getLongString(20000),
    largeField7: getLongString(20000),
    largeField8: getLongString(20000),
    largeField9: getLongString(20000),
    largeField10: getLongString(20000),
    objectId: new ObjectId(),
    createdAt: new Date(),
  });
}
print("Inserting dbC high priority documents...");
highImpact.dbC.insertMany(docs);
print("Finished inserting dbC high priority documents");

// Scenario 4: Small documents (10KB avg), small delta
// Target: 10KB * 3000 documents scanned = 30MB impact
// Create 3000 documents with category: 'standard', 5 with category: 'special'
print("Creating collection dbD with small documents...");
docs = [];
const numStandardDocs = 3000;
for (let i = 0; i < numStandardDocs; i++) {
  docs.push({
    category: "standard",
    itemId: i,
    content1: getLongString(12000), // ~12KB
    content2: getLongString(12000), // ~12KB
    content3: getLongString(12000), // ~12KB
    content4: getLongString(12000), // ~12KB
    nestedData: {
      field1: getLongString(2000), // ~2KB
      field2: getLongString(2000), // ~2KB
      field3: getLongString(2000), // ~2KB
      field4: getLongString(2000), // ~2KB
    },
    identifier: new ObjectId(),
  });
}
print("Inserting dbD standard documents...");
highImpact.dbD.insertMany(docs);
print("Finished inserting dbD standard documents");

docs = [];
const numSpecialDocs = 5;
for (let i = 0; i < numSpecialDocs; i++) {
  docs.push({
    category: "special",
    itemId: numStandardDocs + i,
    content1: getLongString(12000),
    content2: getLongString(12000),
    content3: getLongString(12000),
    content4: getLongString(12000),
    nestedData: {
      field1: getLongString(2000),
      field2: getLongString(2000),
      field3: getLongString(2000),
      field4: getLongString(2000),
    },
    identifier: new ObjectId(),
  });
}
print("Inserting dbD special documents...");
highImpact.dbD.insertMany(docs);
print("Finished inserting dbD special documents");

// Enable capturing all queries
try {
  highImpact.setProfilingLevel(0, -1);
} catch (e) {
  print(
    "Error during setProfilingLevel - assuming this is a serverless cluster:",
    e.message,
  );
}

let x;

// Run queries to generate high impact slow logs
print("Running queries to generate high impact slow logs...");

const numIterations = 20;
for (let i = 0; i < numIterations; i++) {
  if (i % (numIterations / 10) === 0) {
    print(`${(i / numIterations) * 100}% complete running queries`);
  }

  // Query 1: dbA - scans 2000 docs of ~100KB each
  // Impact: (2000 scanned - 5 returned) * 100KB ≈ 200MB
  x = highImpact.dbA.find({
    status: "archived",
  });
  x.hasNext();

  // Query 2: dbB - scans 15000 docs of ~10KB each
  // Impact: (15000 scanned - 10 returned) * 10KB ≈ 150MB
  x = highImpact.dbB.find({
    type: "premium",
  });
  x.hasNext();

  // Query 3: dbC - scans 600 docs of ~200KB each
  // Impact: (600 scanned - 3 returned) * 200KB ≈ 120MB
  x = highImpact.dbC.find({
    priority: 10,
  });
  x.hasNext();

  // Query 4: dbD - scans 3000 docs of ~10KB each
  // Impact: (3000 scanned - 5 returned) * 10KB ≈ 30MB
  x = highImpact.dbD.find({
    category: "special",
  });
  x.hasNext();
}

print("Finished running queries");

// Disable profiling
try {
  highImpact.setProfilingLevel(0, 100);
} catch (e) {
  print(
    "Error during setProfilingLevel - assuming this is a serverless cluster:",
    e.message,
  );
}

print("High impact mock data generation complete!");
print("Expected impacts:");
print("  - dbA.archived: ~200MB impact");
print("  - dbB.premium: ~150MB impact");
print("  - dbC.priority=10: ~120MB impact");
print("  - dbD.special: ~30MB impact");
