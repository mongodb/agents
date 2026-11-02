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

const path = `/groups/${PROJECT}/flexClusters:tenantUpgrade`;

const withFlex = () =>
  createTestAtlas({
    ...baseFixture,
    projects: [
      {
        ...baseFixture.projects[0],
        flexClusters: [{ name: "f1", provider: "AWS", region: "US_EAST_1" }],
      },
    ],
  });

const body = (name: string, regionConfig: object = {}) => ({
  name,
  clusterType: "REPLICASET",
  replicationSpecs: [
    {
      regionConfigs: [
        {
          providerName: "AWS",
          regionName: "US_EAST_1",
          priority: 7,
          electableSpecs: { instanceSize: "M10", nodeCount: 3 },
          autoScaling: {
            compute: {
              enabled: true,
              scaleDownEnabled: true,
              minInstanceSize: "M10",
              maxInstanceSize: "M30",
            },
            diskGB: { enabled: true },
          },
          ...regionConfig,
        },
      ],
    },
  ],
});

describe("POST /groups/:groupId/flexClusters:tenantUpgrade", () => {
  it("moves a flex cluster to the dedicated clusters as M10", async () => {
    const atlas = withFlex();
    const res = await atlas.call("POST", path, body("f1"));

    expect(res.status).toBe(200);
    const project = atlas.account.state().projects[0];
    expect(project.flexClusters).toEqual([]);
    expect(project.clusters.at(-1)).toMatchObject({
      name: "f1",
      instanceSize: "M10",
      provider: "AWS",
      region: "US_EAST_1",
      autoScaling: { enabled: true, maxInstanceSize: "M30" },
    });
  });

  it("uses the provider and region the body names", async () => {
    const atlas = withFlex();
    await atlas.call(
      "POST",
      path,
      body("f1", { providerName: "GCP", regionName: "CENTRAL_US" }),
    );

    expect(atlas.account.state().projects[0].clusters.at(-1)).toMatchObject({
      provider: "GCP",
      region: "CENTRAL_US",
    });
  });

  it("answers 404 for a flex cluster that does not exist", async () => {
    const res = await withFlex().call("POST", path, body("nope"));

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("CLUSTER_NOT_FOUND");
  });

  it("rejects a body that is not an M10 upgrade", async () => {
    const res = await withFlex().call(
      "POST",
      path,
      body("f1", { electableSpecs: { instanceSize: "M30", nodeCount: 3 } }),
    );

    expect(res.status).toBe(400);
  });

  it("answers 404 for an unknown project", async () => {
    const res = await withFlex().call(
      "POST",
      `/groups/${OTHER_PROJECT}/flexClusters:tenantUpgrade`,
      body("f1"),
    );

    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });
});
