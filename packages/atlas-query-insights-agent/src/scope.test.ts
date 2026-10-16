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

import { describeScope, resolveScope } from "./scope.js";

const PROJECT = "507f1f77bcf86cd799439011";

describe("resolveScope", () => {
  it("treats undefined or an empty object as unpinned", () => {
    expect(resolveScope()).toBeUndefined();
    expect(resolveScope({})).toBeUndefined();
  });

  it("keeps a valid project with all clusters, no clusters, or specific clusters", () => {
    expect(resolveScope({ [` ${PROJECT} `]: {} })).toEqual({
      [PROJECT]: {},
    });
    expect(resolveScope({ [PROJECT]: { clusterNames: [] } })).toEqual({
      [PROJECT]: { clusterNames: [] },
    });
    expect(
      resolveScope({
        [PROJECT]: { clusterNames: ["Cluster-1", "analytics_0"] },
      }),
    ).toEqual({
      [PROJECT]: { clusterNames: ["Cluster-1", "analytics_0"] },
    });
  });

  it("rejects an id or name Atlas would not accept", () => {
    expect(() => resolveScope({ cluster0: {} })).toThrow(/projectId/);
    expect(() =>
      resolveScope({ [PROJECT]: { clusterNames: ["-leading"] } }),
    ).toThrow(/clusterName/);
  });
});

describe("describeScope", () => {
  it("describes each dataAccess configuration the prompt can quote", () => {
    expect(describeScope(undefined)).toMatch(/No project or cluster is pinned/);
    expect(describeScope({})).toMatch(/No project or cluster is pinned/);
    expect(describeScope({ [PROJECT]: {} })).toBe(
      `Access is limited to project ${PROJECT} (all clusters).`,
    );
    expect(describeScope({ [PROJECT]: { clusterNames: [] } })).toBe(
      `Access is limited to project ${PROJECT} (no clusters allowed).`,
    );
    expect(
      describeScope({ [PROJECT]: { clusterNames: ["Cluster-1"] } }),
    ).toBe(`Access is limited to cluster Cluster-1 in project ${PROJECT}.`);
  });
});
