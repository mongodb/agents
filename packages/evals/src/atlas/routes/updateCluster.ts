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
import { z } from "zod";

import type { AtlasEnv } from "../support/env.js";
import { AtlasError } from "../support/errors.js";
import { readJsonBody, requireCluster } from "../support/lookups.js";
import { clusterJson } from "../support/responses.js";

const UpdateBody = z.strictObject({ paused: z.boolean() });

/**
 * `PATCH /groups/:groupId/clusters/:clusterName`. Only `paused` is applied,
 * which is all the pause and resume tool sends. Any other field is rejected,
 * so a case never gets a success for an update the mock did not perform.
 */
export const updateClusterRoute = new Hono<AtlasEnv>().patch(
  "/groups/:groupId/clusters/:clusterName",
  async (c) => {
    const { project, cluster } = requireCluster(
      c,
      c.req.param("groupId"),
      c.req.param("clusterName"),
    );
    const parsed = UpdateBody.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new AtlasError(
        400,
        "INVALID_ATTRIBUTE",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    cluster.paused = parsed.data.paused;
    return c.json(clusterJson(project, cluster));
  },
);
