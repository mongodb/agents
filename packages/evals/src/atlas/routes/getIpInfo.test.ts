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

import { createTestAtlas } from "../testSupport.js";

describe("GET /api/private/ipinfo", () => {
  it("returns the mock caller address", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.send("GET", "/api/private/ipinfo", {
      headers: { authorization: `Bearer ${atlas.token}` },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ currentIpv4Address: "203.0.113.7" });
  });

  it("needs a known account", async () => {
    const res = await createTestAtlas().send("GET", "/api/private/ipinfo");

    expect(res.status).toBe(401);
  });
});
