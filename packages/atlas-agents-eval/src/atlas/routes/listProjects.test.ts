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

import { createTestAtlas, ORG, PROJECT } from "../testSupport.js";

describe("GET /groups", () => {
  it("lists projects with their cluster counts", async () => {
    const res = await createTestAtlas().get("/groups");

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      {
        id: PROJECT,
        name: "prod",
        orgId: ORG,
        clusterCount: 2,
        created: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(res.body.totalCount).toBe(1);
  });
});
