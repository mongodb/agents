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

import { AtlasError } from "./support/errors.js";
import { createAtlasApp } from "./app.js";
import { AccountRegistry } from "./support/accounts.js";
import { createTestAtlas, OTHER_PROJECT, PROJECT } from "./testSupport.js";

describe("createAtlasApp", () => {
  it("answers an unimplemented route with a 404 that names it", async () => {
    const res = await createTestAtlas().call(
      "DELETE",
      `/groups/${PROJECT}/clusters/c1`,
    );

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("NOT_IMPLEMENTED_IN_MOCK");
    expect(res.body.detail).toBe(
      `DELETE /api/atlas/v2/groups/${PROJECT}/clusters/c1 is not implemented ` +
        "by the eval mock Atlas API",
    );
  });

  it("answers an unknown path outside the API prefix with the same 404", async () => {
    const res = await createTestAtlas().send("GET", "/elsewhere");

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("NOT_IMPLEMENTED_IN_MOCK");
  });

  it("sets the Atlas content type on every kind of response", async () => {
    const atlas = createTestAtlas();
    const ok = await atlas.get("/orgs");
    const missing = await atlas.get(`/groups/${OTHER_PROJECT}`);
    const unauthorized = await atlas.send("GET", "/api/atlas/v2/orgs");

    for (const res of [ok, missing, unauthorized]) {
      expect(res.contentType).toBe("application/vnd.atlas.2025-03-12+json");
    }
  });

  it("records each request with its status", async () => {
    const atlas = createTestAtlas();
    await atlas.get("/orgs");
    await atlas.get(`/groups/${OTHER_PROJECT}`);
    await atlas.call("DELETE", `/groups/${PROJECT}`);

    expect(atlas.account.requests()).toEqual([
      { method: "GET", url: "/api/atlas/v2/orgs", status: 200 },
      { method: "GET", url: `/api/atlas/v2/groups/${OTHER_PROJECT}`, status: 404 },
      { method: "DELETE", url: `/api/atlas/v2/groups/${PROJECT}`, status: 404 },
    ]);
  });

  it("keeps the query string in the recorded url", async () => {
    const atlas = createTestAtlas();
    await atlas.get(`/groups/${PROJECT}/alerts?status=OPEN`);

    expect(atlas.account.requests()[0].url).toBe(
      `/api/atlas/v2/groups/${PROJECT}/alerts?status=OPEN`,
    );
  });

  it("does not record unauthenticated requests", async () => {
    const atlas = createTestAtlas();
    await atlas.send("GET", "/api/atlas/v2/orgs");

    expect(atlas.account.requests()).toEqual([]);
  });

  it("records requests per account", async () => {
    const a = createTestAtlas();
    const b = createTestAtlas();
    await a.get("/orgs");

    expect(a.account.requests()).toHaveLength(1);
    expect(b.account.requests()).toHaveLength(0);
  });

  it("turns an unexpected error into a 500 that says what happened", async () => {
    const registry = new AccountRegistry();
    const app = createAtlasApp(registry);
    app.get("/boom", () => {
      throw new Error("kaboom");
    });
    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      errorCode: "MOCK_INTERNAL_ERROR",
      detail: expect.stringContaining("kaboom"),
    });
  });

  it("renders a thrown AtlasError with its status and body", async () => {
    const app = createAtlasApp(new AccountRegistry());
    app.get("/teapot", () => {
      throw new AtlasError(400, "BAD", "why");
    });
    const res = await app.request("/teapot");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 400, errorCode: "BAD", detail: "why" });
  });
});
