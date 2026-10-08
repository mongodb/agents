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

import { describe, expect, it } from "vitest";

import {
  formatTokenLimitForAgent,
  isTokenExhaustionError,
} from "./tokenLimit.js";

describe("token limit helpers", () => {
  it("reuses the classifier shared with the chat clients", () => {
    expect(
      isTokenExhaustionError(
        new Error("did not become ready during startup"),
      ),
    ).toBe(true);
    expect(isTokenExhaustionError(new Error("invalid projection"))).toBe(
      false,
    );
  });

  it("names the failed tool and tells the model not to retry", () => {
    const text = formatTokenLimitForAgent("atlas-list-clusters");

    expect(text).toContain('Tool "atlas-list-clusters"');
    expect(text).toContain("Do not call more tools");
    expect(text).toContain("try again in about an hour");
  });
});
