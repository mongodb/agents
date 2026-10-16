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

import {
  describeDataAccess,
  resolveDataAccess,
  type DataAccessConfig,
  type ResolvedDataAccess,
} from "@repo/agent-engine-core";

export const UNPINNED_SCOPE_DESCRIPTION =
  "No project or cluster is pinned. Resolve the project and cluster before analyzing slow queries.";

/**
 * Validates and normalizes the optional `dataAccess` map from config.
 * Returns `undefined` when `dataAccess` is omitted or empty (`{}`).
 */
export function resolveScope(
  input?: DataAccessConfig,
): ResolvedDataAccess | undefined {
  return resolveDataAccess(input);
}

export function describeScope(dataAccess?: DataAccessConfig): string {
  return describeDataAccess(dataAccess) ?? UNPINNED_SCOPE_DESCRIPTION;
}
