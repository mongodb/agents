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

import { createTestAtlas, ORG } from "../testSupport.js";

describe("GET /orgs", () => {
  it("lists the seeded organizations in the Atlas page shape", async () => {
    const res = await createTestAtlas().get("/orgs");

    expect(res.status).toBe(200);
    expect(res.contentType).toContain("application/vnd.atlas");
    expect(res.body).toEqual({
      results: [{ id: ORG, name: "Acme" }],
      totalCount: 1,
      links: [],
    });
  });
});
