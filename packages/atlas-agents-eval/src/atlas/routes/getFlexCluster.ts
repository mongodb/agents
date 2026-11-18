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
import { AtlasError } from "../support/errors.js";
import { requireProject } from "../support/lookups.js";
import { flexClusterJson } from "../support/responses.js";

/**
 * `GET /groups/:groupId/flexClusters/:clusterName`. The tools try this after
 * a dedicated cluster lookup fails.
 */
export const getFlexClusterRoute = new Hono<AtlasEnv>().get(
  "/groups/:groupId/flexClusters/:clusterName",
  (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const name = c.req.param("clusterName");
    const flex = project.flexClusters.find(
      (candidate) => candidate.name === name,
    );
    if (!flex) {
      throw new AtlasError(
        404,
        "CLUSTER_NOT_FOUND",
        `No flex cluster named ${name}`,
      );
    }
    return c.json(flexClusterJson(project, flex));
  },
);
