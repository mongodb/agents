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
  clientIdFromBasicAuth,
  clientIdFromToken,
  tokenFor,
} from "./auth.js";
import { createTestAtlas } from "../testSupport.js";

describe("clientIdFromBasicAuth", () => {
  it("reads the user part of a Basic header", () => {
    const header = `Basic ${Buffer.from("id:secret").toString("base64")}`;

    expect(clientIdFromBasicAuth(header)).toBe("id");
  });

  it("returns undefined for a missing, non-Basic, or empty id", () => {
    const empty = `Basic ${Buffer.from(":secret").toString("base64")}`;

    expect(clientIdFromBasicAuth(undefined)).toBeUndefined();
    expect(clientIdFromBasicAuth("Bearer abc")).toBeUndefined();
    expect(clientIdFromBasicAuth(empty)).toBeUndefined();
  });
});

describe("tokenFor and clientIdFromToken", () => {
  it("round-trips a client id, including unusual characters", () => {
    const clientId = "case/1 with.dots:and+symbols";

    expect(clientIdFromToken(`Bearer ${tokenFor(clientId)}`)).toBe(clientId);
  });

  it("makes a different token each time", () => {
    expect(tokenFor("a")).not.toBe(tokenFor("a"));
  });

  it("returns undefined without a Bearer token", () => {
    expect(clientIdFromToken(undefined)).toBeUndefined();
    expect(clientIdFromToken("Basic abc")).toBeUndefined();
  });
});

describe("requireAccount", () => {
  it("answers 401 UNAUTHORIZED without a token", async () => {
    const res = await createTestAtlas().send("GET", "/api/atlas/v2/orgs");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 401, errorCode: "UNAUTHORIZED" });
  });

  it("answers 401 for a token of an unregistered client id", async () => {
    const res = await createTestAtlas().send("GET", "/api/atlas/v2/orgs", {
      headers: { authorization: `Bearer ${tokenFor("stranger")}` },
    });

    expect(res.status).toBe(401);
  });

  it("answers 401 once the account is released", async () => {
    const atlas = createTestAtlas();
    atlas.account.release();

    expect((await atlas.get("/orgs")).status).toBe(401);
  });
});
