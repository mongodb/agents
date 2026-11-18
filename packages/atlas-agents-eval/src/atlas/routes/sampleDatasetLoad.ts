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

import { randomBytes } from "node:crypto";

import { Hono } from "hono";

import type { AtlasEnv } from "../support/env.js";
import { AtlasError } from "../support/errors.js";
import { requireCluster, requireProject } from "../support/lookups.js";

type Load = ReturnType<typeof requireProject>["sampleDatasetLoads"][number];

const loadJson = (load: Load) => ({
  _id: load.id,
  clusterName: load.clusterName,
  state: load.state,
  createDate: load.createDate,
});

/**
 * `POST /groups/:groupId/sampleDatasetLoad/:name` starts a load into the
 * named cluster, and `GET /groups/:groupId/sampleDatasetLoad/:id` reads it
 * back. A new load is `WORKING`. The mock never finishes it, since it has no
 * state over time.
 */
export const sampleDatasetLoadRoute = new Hono<AtlasEnv>()
  .post("/groups/:groupId/sampleDatasetLoad/:name", (c) => {
    const { project, cluster } = requireCluster(
      c,
      c.req.param("groupId"),
      c.req.param("name"),
    );
    const load: Load = {
      id: randomBytes(12).toString("hex"),
      clusterName: cluster.name,
      state: "WORKING",
      createDate: new Date().toISOString(),
    };
    project.sampleDatasetLoads.push(load);
    return c.json(loadJson(load));
  })
  .get("/groups/:groupId/sampleDatasetLoad/:id", (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const id = c.req.param("id");
    const load = project.sampleDatasetLoads.find(
      (candidate) => candidate.id === id,
    );
    if (!load) {
      throw new AtlasError(
        404,
        "SAMPLE_DATASET_LOAD_NOT_FOUND",
        `No sample dataset load with ID ${id}`,
      );
    }
    return c.json(loadJson(load));
  });
