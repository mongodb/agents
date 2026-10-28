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

const basic = (clientId: string) =>
  `Basic ${Buffer.from(`${clientId}:mock-secret`).toString("base64")}`;

describe("POST /api/oauth/token", () => {
  it("issues a bearer token to a registered client id in Basic auth", async () => {
    const atlas = createTestAtlas(undefined, "known");
    const res = await atlas.send("POST", "/api/oauth/token", {
      headers: {
        authorization: basic("known"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(res.body.access_token).toMatch(/^mock\./);
  });

  it("accepts the client id from the form body", async () => {
    const atlas = createTestAtlas(undefined, "known");
    const res = await atlas.send("POST", "/api/oauth/token", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=known",
    });

    expect(res.status).toBe(200);
  });

  it("issues a token that the Atlas routes accept", async () => {
    const atlas = createTestAtlas(undefined, "known");
    const token = await atlas.send("POST", "/api/oauth/token", {
      headers: { authorization: basic("known") },
    });
    const res = await atlas.send("GET", "/api/atlas/v2/orgs", {
      headers: { authorization: `Bearer ${token.body.access_token}` },
    });

    expect(res.status).toBe(200);
  });

  it("answers 401 invalid_client for an unregistered client id", async () => {
    const res = await createTestAtlas().send("POST", "/api/oauth/token", {
      headers: { authorization: basic("nobody") },
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_client" });
  });

  it("answers 401 when no client id is sent", async () => {
    const res = await createTestAtlas().send("POST", "/api/oauth/token");

    expect(res.status).toBe(401);
  });
});
