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

import type { AtlasEnv } from "../env.js";
import { requireProject } from "../lookups.js";
import { atlasPage } from "../responses.js";

/**
 * `GET /groups/:groupId/flexClusters`. The fixtures hold no flex clusters, but
 * the tools ask for them next to the dedicated ones.
 */
export const listFlexClustersRoute = new Hono<AtlasEnv>().get(
  "/groups/:groupId/flexClusters",
  (c) => {
    requireProject(c, c.req.param("groupId"));
    return c.json(atlasPage([]));
  },
);
