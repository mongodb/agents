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

import type { MongoAccess } from "../tools/types.js";

/**
 * Asserts something about a case's MongoDB after the agent finishes, by
 * throwing (use `node:assert/strict`) when it does not hold. The task runs it
 * while the case's `mongod` is still up, so it reads the real end state.
 *
 * A check only reads. Throwing an `AssertionError` fails the case's
 * `MongoCheck` score. Any other error, such as a lost connection, fails the
 * case, so an infrastructure fault is not scored as a wrong answer.
 */
export type MongoCheck = (mongo: MongoAccess) => Promise<void>;
