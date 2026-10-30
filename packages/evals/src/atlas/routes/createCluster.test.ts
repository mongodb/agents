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

const path = `/groups/${PROJECT}/clusters`;

const body = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  clusterType: "REPLICASET",
  mongoDBMajorVersion: "8.0",
  backupEnabled: true,
  replicationSpecs: [
    {
      regionConfigs: [
        {
          providerName: "GCP",
          regionName: "CENTRAL_US",
          priority: 7,
          electableSpecs: { instanceSize: "M30", nodeCount: 3 },
          autoScaling: {
            compute: {
              enabled: true,
              scaleDownEnabled: true,
              minInstanceSize: "M30",
              maxInstanceSize: "M50",
            },
            diskGB: { enabled: true },
          },
        },
      ],
    },
  ],
  ...overrides,
});

const regions = (...names: string[]) => ({
  replicationSpecs: [
    {
      regionConfigs: names.map((regionName, i) => ({
        providerName: "AWS",
        regionName,
        priority: 7 - i,
        electableSpecs: { instanceSize: "M10", nodeCount: 3 },
      })),
    },
  ],
});

describe("POST /groups/:groupId/clusters", () => {
  it("stores a CREATING cluster and returns it with 201", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.call("POST", path, body("new"));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "new", stateName: "CREATING" });
    expect(atlas.account.state().projects[0].clusters.at(-1)).toMatchObject({
      name: "new",
      instanceSize: "M30",
      provider: "GCP",
      region: "CENTRAL_US",
      state: "CREATING",
      autoScaling: { enabled: true, maxInstanceSize: "M50" },
    });
  });

  it("lists the new cluster", async () => {
    const atlas = createTestAtlas();
    await atlas.call("POST", path, body("new"));
    const res = await atlas.get(path);

    expect(res.body.results.map((c: { name: string }) => c.name)).toEqual([
      "c1",
      "c2",
      "new",
    ]);
  });

  it("keeps every region, highest priority first", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.call(
      "POST",
      path,
      body("multi", regions("US_EAST_1", "US_WEST_2")),
    );

    expect(
      res.body.replicationSpecs[0].regionConfigs.map(
        (r: { regionName: string; priority: number }) => [
          r.regionName,
          r.priority,
        ],
      ),
    ).toEqual([
      ["US_EAST_1", 7],
      ["US_WEST_2", 6],
    ]);
  });

  it("stores a sharded cluster", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.call(
      "POST",
      path,
      body("sharded", { clusterType: "SHARDED" }),
    );

    expect(res.body.clusterType).toBe("SHARDED");
  });

  it("rejects a sharded cluster below M30", async () => {
    const res = await createTestAtlas().call(
      "POST",
      path,
      body("sharded", { clusterType: "SHARDED", ...regions("US_EAST_1") }),
    );

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("M30");
  });

  it("answers 409 for a name a cluster already uses", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.call("POST", path, body("c1"));

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe("DUPLICATE_CLUSTER_NAME");
    expect(atlas.account.state().projects[0].clusters).toHaveLength(2);
  });

  it("answers 409 for a name a flex cluster already uses", async () => {
    const atlas = createTestAtlas({
      ...baseFixture,
      projects: [
        { ...baseFixture.projects[0], flexClusters: [{ name: "f1" }] },
      ],
    });

    expect((await atlas.call("POST", path, body("f1"))).status).toBe(409);
  });

  it("rejects repeated regions and unknown sizes", async () => {
    const atlas = createTestAtlas();

    expect(
      (
        await atlas.call(
          "POST",
          path,
          body("a", regions("US_EAST_1", "US_EAST_1")),
        )
      ).status,
    ).toBe(400);
    const badSize = body("b");
    badSize.replicationSpecs[0].regionConfigs[0].electableSpecs.instanceSize =
      "M25";
    expect((await atlas.call("POST", path, badSize)).status).toBe(400);
  });

  it("rejects a body without a name", async () => {
    const res = await createTestAtlas().call("POST", path, {
      ...body("x"),
      name: undefined,
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_ATTRIBUTE");
  });

  it("answers 404 for an unknown project", async () => {
    const res = await createTestAtlas().call(
      "POST",
      `/groups/${OTHER_PROJECT}/clusters`,
      body("new"),
    );

    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });
});
