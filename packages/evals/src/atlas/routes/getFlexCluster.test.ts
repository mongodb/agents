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
  baseFixture,
  createTestAtlas,
  OTHER_PROJECT,
  PROJECT,
} from "../testSupport.js";

const withFlex = () =>
  createTestAtlas({
    ...baseFixture,
    projects: [
      {
        ...baseFixture.projects[0],
        flexClusters: [{ name: "f1", provider: "GCP", region: "CENTRAL_US" }],
      },
    ],
  });

describe("GET /groups/:groupId/flexClusters/:clusterName", () => {
  it("returns a flex cluster in the Atlas shape", async () => {
    const res = await withFlex().get(`/groups/${PROJECT}/flexClusters/f1`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "f1",
      groupId: PROJECT,
      stateName: "IDLE",
      providerSettings: {
        providerName: "FLEX",
        backingProviderName: "GCP",
        regionName: "CENTRAL_US",
      },
    });
  });

  it("answers 404 CLUSTER_NOT_FOUND for another name", async () => {
    const res = await createTestAtlas().get(
      `/groups/${PROJECT}/flexClusters/c1`,
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 404,
      errorCode: "CLUSTER_NOT_FOUND",
      detail: "No flex cluster named c1",
    });
  });

  it("answers GROUP_NOT_FOUND first for an unknown project", async () => {
    const res = await createTestAtlas().get(
      `/groups/${OTHER_PROJECT}/flexClusters/c1`,
    );

    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });
});
