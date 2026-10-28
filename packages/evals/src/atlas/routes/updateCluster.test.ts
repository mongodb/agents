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

import { createTestAtlas, PROJECT } from "../testSupport.js";

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

  it("ignores fields other than paused", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.patch(c1, { name: "renamed", paused: "yes" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "c1", paused: false });
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
