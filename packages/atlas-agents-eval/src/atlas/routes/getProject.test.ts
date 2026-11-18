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
  createTestAtlas,
  ORG,
  OTHER_PROJECT,
  PROJECT,
} from "../testSupport.js";

describe("GET /groups/:groupId", () => {
  it("returns the project", async () => {
    const res = await createTestAtlas().get(`/groups/${PROJECT}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: PROJECT,
      name: "prod",
      orgId: ORG,
      clusterCount: 2,
    });
  });

  it("answers 404 GROUP_NOT_FOUND for an unknown project", async () => {
    const res = await createTestAtlas().get(`/groups/${OTHER_PROJECT}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 404,
      errorCode: "GROUP_NOT_FOUND",
      detail: `No project with ID ${OTHER_PROJECT}`,
    });
  });
});
