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

import { describe, expect, it, vi } from "vitest";

import { loadFixture } from "../fixtures.js";
import type { CaseTools, CaseToolsRequest, ToolProvider } from "./types.js";
import { withNamedFixtures } from "./withNamedFixtures.js";

const caseTools: CaseTools = {
  tools: [],
  state: () => ({}),
  dispose: async () => {},
};

describe("withNamedFixtures", () => {
  it("passes fixture data, not names, to the wrapped provider", async () => {
    const forCase = vi.fn(async (_request: CaseToolsRequest) => caseTools);
    const provider = withNamedFixtures({ forCase });

    await provider.forCase({
      allowWrites: true,
      setup: { mockAtlas: "one-project", localMongo: "shop-orders" },
    });

    expect(forCase).toHaveBeenCalledWith({
      allowWrites: true,
      setup: {
        mockAtlas: loadFixture("mockAtlas", "one-project"),
        localMongo: loadFixture("localMongo", "shop-orders"),
      },
    });
  });

  it("forwards start and stop", async () => {
    const inner: ToolProvider = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      forCase: async () => caseTools,
    };
    const provider = withNamedFixtures(inner);
    await provider.start?.();
    await provider.stop?.();
    expect(inner.start).toHaveBeenCalledOnce();
    expect(inner.stop).toHaveBeenCalledOnce();
  });

  it("fails a case that names a missing fixture", async () => {
    const provider = withNamedFixtures({ forCase: async () => caseTools });
    await expect(
      provider.forCase({ allowWrites: false, setup: { mockAtlas: "nope" } }),
    ).rejects.toThrow(/unknown mockAtlas fixture "nope"/);
  });
});
