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

const path = `/groups/${PROJECT}/clusters/tenantUpgrade`;

const withFree = () =>
  createTestAtlas({
    ...baseFixture,
    projects: [
      {
        ...baseFixture.projects[0],
        clusters: [
          { name: "free", instanceSize: "M0", provider: "GCP", region: "CENTRAL_US" },
          { name: "c1" },
        ],
      },
    ],
  });

const toFlex = (name: string) => ({
  name,
  providerSettings: {
    providerName: "FLEX",
    instanceSizeName: "FLEX",
    backingProviderName: "GCP",
    regionName: "CENTRAL_US",
  },
});

const toM10 = (name: string, extra: object = {}) => ({
  name,
  providerSettings: { instanceSizeName: "M10", ...extra },
  autoScaling: {
    compute: { enabled: true, scaleDownEnabled: true },
    diskGBEnabled: true,
  },
});

describe("POST /groups/:groupId/clusters/tenantUpgrade", () => {
  it("moves a free cluster to the flex clusters", async () => {
    const atlas = withFree();
    const res = await atlas.call("POST", path, toFlex("free"));

    expect(res.status).toBe(200);
    const project = atlas.account.state().projects[0];
    expect(project.clusters.map((c) => c.name)).toEqual(["c1"]);
    expect(project.flexClusters).toMatchObject([
      { name: "free", provider: "GCP", region: "CENTRAL_US" },
    ]);
  });

  it("resizes a free cluster to M10 and keeps its region", async () => {
    const atlas = withFree();
    const res = await atlas.call("POST", path, toM10("free"));

    expect(res.status).toBe(200);
    expect(atlas.account.state().projects[0].clusters[0]).toMatchObject({
      name: "free",
      instanceSize: "M10",
      provider: "GCP",
      region: "CENTRAL_US",
      autoScaling: { enabled: true },
    });
  });

  it("applies the provider and region the body names", async () => {
    const atlas = withFree();
    await atlas.call(
      "POST",
      path,
      toM10("free", { providerName: "AWS", regionName: "SA_EAST_1" }),
    );

    expect(atlas.account.state().projects[0].clusters[0]).toMatchObject({
      provider: "AWS",
      region: "SA_EAST_1",
    });
  });

  it("answers 404 for a cluster that does not exist", async () => {
    const res = await withFree().call("POST", path, toFlex("nope"));

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("CLUSTER_NOT_FOUND");
  });

  it("rejects a cluster that is not free", async () => {
    const res = await withFree().call("POST", path, toFlex("c1"));

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("CANNOT_UPGRADE_NON_FREE_CLUSTER");
  });

  it("rejects a body without an instance size", async () => {
    const res = await withFree().call("POST", path, { name: "free" });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_ATTRIBUTE");
  });

  it("answers 404 for an unknown project", async () => {
    const res = await withFree().call(
      "POST",
      `/groups/${OTHER_PROJECT}/clusters/tenantUpgrade`,
      toFlex("free"),
    );

    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });
});
