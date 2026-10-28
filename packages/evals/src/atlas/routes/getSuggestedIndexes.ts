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
import { requireCluster } from "../support/lookups.js";

/** `GET /groups/:groupId/clusters/:clusterName/performanceAdvisor/suggestedIndexes` */
export const getSuggestedIndexesRoute = new Hono<AtlasEnv>().get(
  "/groups/:groupId/clusters/:clusterName/performanceAdvisor/suggestedIndexes",
  (c) => {
    const { cluster } = requireCluster(
      c,
      c.req.param("groupId"),
      c.req.param("clusterName"),
    );
    return c.json({
      content: { shapes: [], suggestedIndexes: cluster.advisor.suggestedIndexes },
    });
  },
);
