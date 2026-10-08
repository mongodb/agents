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

import { assertSafeRunId, runDirectory } from "./paths.js";

describe("assertSafeRunId", () => {
  it("accepts ordinary run ids, including dots inside a name", () => {
    expect(assertSafeRunId("phase0")).toBe("phase0");
    expect(assertSafeRunId("2026-10-08T17-33-38-655Z-same-session")).toBe(
      "2026-10-08T17-33-38-655Z-same-session",
    );
    expect(assertSafeRunId("run.v2")).toBe("run.v2");
  });

  it("rejects the dot segments that resolve outside results/", () => {
    expect(() => assertSafeRunId(".")).toThrow(/dot segment/);
    expect(() => assertSafeRunId("..")).toThrow(/dot segment/);
  });

  it("rejects path separators", () => {
    expect(() => assertSafeRunId("a/b")).toThrow(/may only contain/);
  });

  it("never resolves a run directory outside results/", () => {
    expect(() => runDirectory("..")).toThrow();
  });
});
