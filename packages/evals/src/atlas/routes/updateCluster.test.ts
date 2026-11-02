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

const c1 = `/groups/${PROJECT}/clusters/c1`;

describe("PATCH /groups/:groupId/clusters/:clusterName", () => {
  it("pauses the cluster and returns it", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.patch(c1, { paused: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "c1", paused: true });
    expect(atlas.account.state().projects[0].clusters[0].paused).toBe(true);
  });

  it("resumes a paused cluster", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.patch(`/groups/${PROJECT}/clusters/c2`, {
      paused: false,
    });

    expect(res.body.paused).toBe(false);
  });

  it("rejects fields the mock does not apply", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.patch(c1, { paused: true, diskSizeGB: 20 });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_ATTRIBUTE");
    expect(res.body.detail).toContain("diskSizeGB");
    expect(atlas.account.state().projects[0].clusters[0].paused).toBe(false);
  });

  it("rejects a body without a boolean paused", async () => {
    const atlas = createTestAtlas();

    expect((await atlas.patch(c1, {})).status).toBe(400);
    expect((await atlas.patch(c1, { paused: "yes" })).status).toBe(400);
  });

  describe("replicationSpecs", () => {
    const scale = (instanceSize: string, compute?: object) => ({
      replicationSpecs: [
        {
          regionConfigs: [
            {
              electableSpecs: { instanceSize, nodeCount: 3 },
              ...(compute && { autoScaling: { compute } }),
            },
          ],
        },
      ],
    });

    it("scales the cluster and returns it", async () => {
      const atlas = createTestAtlas();
      const res = await atlas.patch(c1, scale("M20"));

      expect(res.status).toBe(200);
      expect(
        res.body.replicationSpecs[0].regionConfigs[0].electableSpecs,
      ).toMatchObject({ instanceSize: "M20" });
      expect(atlas.account.state().projects[0].clusters[0].instanceSize).toBe(
        "M20",
      );
    });

    it("stores compute autoscaling bounds", async () => {
      const atlas = createTestAtlas();
      const res = await atlas.patch(
        c1,
        scale("M10", {
          enabled: true,
          scaleDownEnabled: true,
          minInstanceSize: "M10",
          maxInstanceSize: "M30",
        }),
      );

      expect(
        res.body.replicationSpecs[0].regionConfigs[0].autoScaling.compute,
      ).toMatchObject({ enabled: true, maxInstanceSize: "M30" });
      expect(atlas.account.state().projects[0].clusters[0].autoScaling).toEqual({
        enabled: true,
        minInstanceSize: "M10",
        maxInstanceSize: "M30",
      });
    });

    it("rejects an instance size that does not exist", async () => {
      const res = await createTestAtlas().patch(c1, scale("M25"));

      expect(res.status).toBe(400);
    });

    it("rejects scaling a free cluster", async () => {
      const atlas = createTestAtlas({
        ...baseFixture,
        projects: [
          {
            ...baseFixture.projects[0],
            clusters: [{ name: "free", instanceSize: "M0" }],
          },
        ],
      });
      const res = await atlas.patch(
        `/groups/${PROJECT}/clusters/free`,
        scale("M20"),
      );

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("CANNOT_SCALE_FREE_CLUSTER");
    });

    it("rejects paused and replicationSpecs in one request", async () => {
      const res = await createTestAtlas().patch(c1, {
        paused: true,
        ...scale("M20"),
      });

      expect(res.status).toBe(400);
    });
  });

  it("changes only the calling account", async () => {
    const a = createTestAtlas();
    const b = createTestAtlas();
    await a.patch(c1, { paused: true });

    expect((await b.get(c1)).body.paused).toBe(false);
  });

  it("answers 400 INVALID_JSON for a malformed body", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.send("PATCH", `/api/atlas/v2${c1}`, {
      headers: { authorization: `Bearer ${atlas.token}` },
      body: "{not json",
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_JSON");
  });

  it("answers 404 CLUSTER_NOT_FOUND for an unknown cluster", async () => {
    const res = await createTestAtlas().patch(
      `/groups/${PROJECT}/clusters/nope`,
      { paused: true },
    );

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("CLUSTER_NOT_FOUND");
  });
});
