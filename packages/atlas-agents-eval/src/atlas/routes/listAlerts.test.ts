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

const ids = (res: { body: { results: { id: string }[] } }) =>
  res.body.results.map((a) => a.id);

describe("GET /groups/:groupId/alerts", () => {
  it("lists every alert without a filter", async () => {
    const res = await createTestAtlas().get(`/groups/${PROJECT}/alerts`);

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["a1", "a2"]);
  });

  it("filters by status", async () => {
    const atlas = createTestAtlas();

    expect(ids(await atlas.get(`/groups/${PROJECT}/alerts?status=OPEN`))).toEqual(
      ["a1"],
    );
    expect(
      ids(await atlas.get(`/groups/${PROJECT}/alerts?status=CLOSED`)),
    ).toEqual(["a2"]);
  });

  it("fills in alert defaults", async () => {
    const res = await createTestAtlas().get(`/groups/${PROJECT}/alerts`);

    expect(res.body.results[0]).toMatchObject({
      status: "OPEN",
      eventTypeName: "HOST_DOWN",
      created: "2026-01-01T00:00:00Z",
    });
  });

  it("answers 404 for an unknown project", async () => {
    const res = await createTestAtlas().get(`/groups/${OTHER_PROJECT}/alerts`);

    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });
});
