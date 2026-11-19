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

import { parseSlackReviewInterruptId } from "./review.js";

describe("parseSlackReviewInterruptId", () => {
  it("accepts legacy JSON review values only when signed thread context matches", () => {
    const value = JSON.stringify({
      channelId: "C123",
      threadTs: "1720000000.000100",
      interruptId: "interrupt-1",
    });

    expect(
      parseSlackReviewInterruptId(
        value,
        "slack:C123:1720000000.000100",
      ),
    ).toBe("interrupt-1");
    expect(
      parseSlackReviewInterruptId(
        value,
        "slack:C999:1720000000.000100",
      ),
    ).toBeNull();
  });

  it("rejects invalid JSON or incomplete payloads and passes plain IDs through", () => {
    expect(
      parseSlackReviewInterruptId(
        "{not-json",
        "slack:C123:1720000000.000100",
      ),
    ).toBeNull();
    expect(
      parseSlackReviewInterruptId(
        JSON.stringify({ channelId: "C123", threadTs: "1720000000.000100" }),
        "slack:C123:1720000000.000100",
      ),
    ).toBeNull();
    expect(
      parseSlackReviewInterruptId(
        "interrupt-2",
        "slack:C123:1720000000.000100",
      ),
    ).toBe("interrupt-2");
  });
});
