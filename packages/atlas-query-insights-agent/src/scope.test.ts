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
  it("treats blank fields as unpinned", () => {
    expect(resolveScope()).toBeUndefined();
    expect(resolveScope({ projectId: "  ", clusterName: "" })).toBeUndefined();
  });

  it("keeps a valid project, cluster, or both", () => {
    expect(resolveScope({ projectId: ` ${PROJECT} ` })).toEqual({
      projectId: PROJECT,
    });
    expect(resolveScope({ clusterName: "Cluster-1" })).toEqual({
      clusterName: "Cluster-1",
    });
    expect(
      resolveScope({ projectId: PROJECT, clusterName: "analytics_0" }),
    ).toEqual({
      projectId: PROJECT,
      clusterName: "analytics_0",
    });
  });

  it("rejects an id or name Atlas would not accept", () => {
    expect(() => resolveScope({ projectId: "cluster0" })).toThrow(/projectId/);
    expect(() => resolveScope({ clusterName: "-leading" })).toThrow(
      /clusterName/,
    );
  });
});

describe("describeScope", () => {
  it("describes each pin the prompt can quote", () => {
    expect(describeScope(undefined)).toMatch(/No project or cluster is pinned/);
    expect(describeScope({ projectId: PROJECT })).toBe(
      `Analysis is limited to project ${PROJECT}.`,
    );
    expect(describeScope({ clusterName: "Cluster-1" })).toBe(
      "Analysis is limited to cluster Cluster-1.",
    );
    expect(
      describeScope({ projectId: PROJECT, clusterName: "Cluster-1" }),
    ).toBe(`Analysis is limited to cluster Cluster-1 in project ${PROJECT}.`);
  });
});
