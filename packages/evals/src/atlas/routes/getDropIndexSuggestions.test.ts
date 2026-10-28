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

import { baseFixture, createTestAtlas, PROJECT } from "../testSupport.js";

const path = `/groups/${PROJECT}/clusters/c1/performanceAdvisor/dropIndexSuggestions`;

describe("GET .../performanceAdvisor/dropIndexSuggestions", () => {
  it("returns the seeded suggestions", async () => {
    const unused = { namespace: "app.orders", index: "old_1" };
    const atlas = createTestAtlas({
      ...baseFixture,
      projects: [
        {
          ...baseFixture.projects[0],
          clusters: [
            {
              name: "c1",
              advisor: { dropIndexSuggestions: { unusedIndexes: [unused] } },
            },
          ],
        },
      ],
    });
    const res = await atlas.get(path);

    expect(res.status).toBe(200);
    expect(res.body.content.unusedIndexes).toEqual([unused]);
  });

  it("has all three lists, empty, by default", async () => {
    const res = await createTestAtlas().get(path);

    expect(res.body).toEqual({
      content: { hiddenIndexes: [], redundantIndexes: [], unusedIndexes: [] },
    });
  });

  it("answers 404 CLUSTER_NOT_FOUND for an unknown cluster", async () => {
    const res = await createTestAtlas().get(
      `/groups/${PROJECT}/clusters/nope/performanceAdvisor/dropIndexSuggestions`,
    );

    expect(res.body.errorCode).toBe("CLUSTER_NOT_FOUND");
  });
});
