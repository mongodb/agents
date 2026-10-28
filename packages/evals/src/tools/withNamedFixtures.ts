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

import { resolveToolSetup, type NamedToolSetup } from "../fixtures.js";
import type { CaseToolsRequest, ToolProvider } from "./types.js";

/**
 * Lets cases name their fixtures. A case's `toolSetup` holds fixture names, so
 * the data never enters the dataset row that Braintrust logs. The names are
 * swapped for data here, as each case's tools are built.
 *
 * This covers the dataset row only. `state()` is unchanged, so the task output
 * still carries the end state for scorers, and fixtures must be synthetic.
 */
export function withNamedFixtures(provider: ToolProvider): ToolProvider {
  return {
    start: provider.start?.bind(provider),
    stop: provider.stop?.bind(provider),
    forCase: async (request: CaseToolsRequest) =>
      provider.forCase({
        ...request,
        setup: resolveToolSetup(request.setup as NamedToolSetup | undefined),
      }),
  };
}
