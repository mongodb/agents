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

const start = (cluster: string) =>
  `/groups/${PROJECT}/sampleDatasetLoad/${cluster}`;

describe("sample dataset load routes", () => {
  it("starts a WORKING load for a cluster", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.call("POST", start("c1"));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clusterName: "c1", state: "WORKING" });
    expect(res.body._id).toMatch(/^[0-9a-f]{24}$/);
    expect(atlas.account.state().projects[0].sampleDatasetLoads).toHaveLength(
      1,
    );
  });

  it("reads a load back by its id", async () => {
    const atlas = createTestAtlas();
    const started = await atlas.call("POST", start("c1"));
    const res = await atlas.get(
      `/groups/${PROJECT}/sampleDatasetLoad/${started.body._id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(started.body);
  });

  it("answers 404 for a load that does not exist", async () => {
    const res = await createTestAtlas().get(
      `/groups/${PROJECT}/sampleDatasetLoad/${"a".repeat(24)}`,
    );

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("SAMPLE_DATASET_LOAD_NOT_FOUND");
  });

  it("answers 404 for a cluster that does not exist", async () => {
    const atlas = createTestAtlas();
    const res = await atlas.call("POST", start("nope"));

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("CLUSTER_NOT_FOUND");
    expect(atlas.account.state().projects[0].sampleDatasetLoads).toEqual([]);
  });

  it("answers 404 for an unknown project", async () => {
    const res = await createTestAtlas().call(
      "POST",
      `/groups/${OTHER_PROJECT}/sampleDatasetLoad/c1`,
    );

    expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
  });

  it("keeps loads in the account that started them", async () => {
    const a = createTestAtlas();
    const b = createTestAtlas({ ...baseFixture });
    const started = await a.call("POST", start("c1"));
    const res = await b.get(
      `/groups/${PROJECT}/sampleDatasetLoad/${started.body._id}`,
    );

    expect(res.status).toBe(404);
  });
});
