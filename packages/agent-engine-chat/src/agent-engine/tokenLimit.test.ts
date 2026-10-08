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

import { AgenticApiError } from "./client.js";
import { isTokenExhaustionError } from "./tokenLimit.js";

describe("isTokenExhaustionError", () => {
  it("recognizes the startup failure Agent Engine reports", () => {
    expect(
      isTokenExhaustionError(
        new AgenticApiError(
          "The agent did not become ready during startup.",
          { status: 500, requestOutcome: "unknown" },
        ),
      ),
    ).toBe(true);
  });

  it("recognizes the runtime log message regardless of case", () => {
    expect(
      isTokenExhaustionError(new Error("Access Token limit reached")),
    ).toBe(true);
    expect(isTokenExhaustionError("ACCESS TOKEN LIMIT REACHED")).toBe(
      true,
    );
  });

  it("finds the signature in a wrapped cause", () => {
    expect(
      isTokenExhaustionError(
        new Error("Tool call failed", {
          cause: new Error("Access Token limit reached"),
        }),
      ),
    ).toBe(true);
  });

  it("recognizes error-like objects", () => {
    expect(
      isTokenExhaustionError({
        message: "The agent did not become ready during startup.",
      }),
    ).toBe(true);
  });

  it("does not match unrelated failures", () => {
    expect(isTokenExhaustionError(new Error("Request timed out"))).toBe(
      false,
    );
    expect(
      isTokenExhaustionError(
        new AgenticApiError("Agentic request failed", {
          status: 500,
          requestOutcome: "unknown",
        }),
      ),
    ).toBe(false);
    expect(isTokenExhaustionError(undefined)).toBe(false);
    expect(isTokenExhaustionError(null)).toBe(false);
    expect(isTokenExhaustionError(42)).toBe(false);
    expect(isTokenExhaustionError({})).toBe(false);
  });

  it("stops following a circular cause chain", () => {
    const error = new Error("loop");
    (error as { cause?: unknown }).cause = error;

    expect(isTokenExhaustionError(error)).toBe(false);
  });
});
