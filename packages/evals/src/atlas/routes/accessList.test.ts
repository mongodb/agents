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
  baseFixture,
  createTestAtlas,
  OTHER_PROJECT,
  PROJECT,
} from "../testSupport.js";

const path = `/groups/${PROJECT}/accessList`;

describe("access list routes", () => {
  it("adds entries to the project", async () => {
    const atlas = createTestAtlas();
    const created = await atlas.call("POST", path, [
      { ipAddress: "198.51.100.1", comment: "office" },
    ]);

    expect(created.status).toBe(201);
    expect(created.body.results).toMatchObject([
      { ipAddress: "198.51.100.1", comment: "office", groupId: PROJECT },
    ]);
    expect(atlas.account.state().projects[0].accessList).toHaveLength(1);
  });

  it("answers 409 for an address already in the list", async () => {
    const atlas = createTestAtlas({
      ...baseFixture,
      projects: [
        {
          ...baseFixture.projects[0],
          accessList: [{ ipAddress: "203.0.113.7" }],
        },
      ],
    });
    const res = await atlas.call("POST", path, [{ ipAddress: "203.0.113.7" }]);

    expect(res.status).toBe(409);
    expect(atlas.account.state().projects[0].accessList).toHaveLength(1);
  });

  it("rejects a body that is not a list of entries", async () => {
    const atlas = createTestAtlas();

    expect(
      (await atlas.call("POST", path, { ipAddress: "1.1.1.1" })).status,
    ).toBe(400);
    expect((await atlas.call("POST", path, [])).status).toBe(400);
  });

  it("answers 404 for a project that does not exist", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.call(
      "POST",
      `/groups/${OTHER_PROJECT}/accessList`,
      [{ ipAddress: "198.51.100.1" }],
    );

    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });
});
