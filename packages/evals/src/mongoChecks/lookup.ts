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

import { MONGO_CHECKS } from "./registry.js";
import type { MongoCheck } from "./types.js";

export function mongoCheckNames(
  checks: Readonly<Record<string, MongoCheck>> = MONGO_CHECKS,
): string[] {
  return Object.keys(checks).sort();
}

/** Throws, naming the valid choices, unless `name` is a registered check. */
export function assertMongoCheckExists(
  name: string,
  checks: Readonly<Record<string, MongoCheck>> = MONGO_CHECKS,
): void {
  if (!Object.hasOwn(checks, name)) {
    throw new Error(
      `unknown mongoCheck "${name}". Available: ${mongoCheckNames(checks).join(", ")}`,
    );
  }
}
