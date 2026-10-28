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

describe("GET /groups/:groupId/clusters", () => {
  it("lists the project's clusters in the Atlas shape", async () => {
    const res = await createTestAtlas().get(`/groups/${PROJECT}/clusters`);

    expect(res.status).toBe(200);
    expect(res.body.results.map((c: { name: string }) => c.name)).toEqual([
      "c1",
      "c2",
    ]);
    expect(res.body.results[0]).toMatchObject({
      groupId: PROJECT,
      stateName: "IDLE",
      paused: false,
      mongoDBVersion: "8.0.4",
      replicationSpecs: [
        {
          regionConfigs: [
            {
              providerName: "AWS",
              regionName: "US_EAST_1",
              electableSpecs: { instanceSize: "M10", nodeCount: 3 },
            },
          ],
        },
      ],
    });
  });

  it("gives each cluster a distinct id", async () => {
    const res = await createTestAtlas().get(`/groups/${PROJECT}/clusters`);
    const ids = res.body.results.map((c: { id: string }) => c.id);

    expect(new Set(ids).size).toBe(2);
  });

  it("answers 404 for an unknown project", async () => {
    const res = await createTestAtlas().get(
      `/groups/${OTHER_PROJECT}/clusters`,
    );

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });
});
