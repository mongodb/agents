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

import { createTestAtlas, OTHER_PROJECT, PROJECT } from "../testSupport.js";

describe("GET /groups/:groupId/clusters/:clusterName", () => {
  it("returns the cluster", async () => {
    const res = await createTestAtlas().get(`/groups/${PROJECT}/clusters/c2`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "c2", paused: true });
  });

  it("builds node hosts and connection strings from the name", async () => {
    const res = await createTestAtlas().get(`/groups/${PROJECT}/clusters/c1`);

    expect(res.body.connectionStrings).toEqual({
      standard:
        "mongodb://c1-shard-00-00.mock.mongodb.net:27017," +
        "c1-shard-00-01.mock.mongodb.net:27017," +
        "c1-shard-00-02.mock.mongodb.net:27017/?ssl=true",
      standardSrv: "mongodb+srv://c1.mock.mongodb.net",
    });
  });

  it("answers 404 CLUSTER_NOT_FOUND and names the cluster", async () => {
    const res = await createTestAtlas().get(`/groups/${PROJECT}/clusters/nope`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 404,
      errorCode: "CLUSTER_NOT_FOUND",
      detail: `No cluster named nope exists in group ${PROJECT}`,
    });
  });

  it("answers 404 GROUP_NOT_FOUND for an unknown project", async () => {
    const res = await createTestAtlas().get(
      `/groups/${OTHER_PROJECT}/clusters/c1`,
    );

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });
});
