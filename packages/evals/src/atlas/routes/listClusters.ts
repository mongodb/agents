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

import { Hono } from "hono";

import type { AtlasEnv } from "../support/env.js";
import { requireProject } from "../support/lookups.js";
import { atlasPage, clusterJson } from "../support/responses.js";

/** `GET /groups/:groupId/clusters` */
export const listClustersRoute = new Hono<AtlasEnv>().get(
  "/groups/:groupId/clusters",
  (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    return c.json(
      atlasPage(project.clusters.map((cluster) => clusterJson(project, cluster))),
    );
  },
);
