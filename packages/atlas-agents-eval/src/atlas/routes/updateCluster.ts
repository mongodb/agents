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
import { INSTANCE_SIZE } from "../support/instanceSizes.js";
import { clusterJson } from "../support/responses.js";

const ComputeBody = z.object({
  enabled: z.boolean(),
  scaleDownEnabled: z.boolean().optional(),
  minInstanceSize: z.string().regex(INSTANCE_SIZE).optional(),
  maxInstanceSize: z.string().regex(INSTANCE_SIZE).optional(),
});

const RegionConfigBody = z.looseObject({
  electableSpecs: z
    .looseObject({ instanceSize: z.string().regex(INSTANCE_SIZE) })
    .optional(),
  autoScaling: z.looseObject({ compute: ComputeBody.optional() }).optional(),
});

const UpdateBody = z
  .strictObject({
    paused: z.boolean().optional(),
    replicationSpecs: z
      .array(
        z.looseObject({
          regionConfigs: z.array(RegionConfigBody).min(1),
        }),
      )
      .length(1)
      .optional(),
  })
  .refine(
    (body) =>
      (body.paused === undefined) !== (body.replicationSpecs === undefined),
    { message: "Send either paused or replicationSpecs, and not both" },
  );

/**
 * `PATCH /groups/:groupId/clusters/:clusterName`. Applies the two updates the
 * tools send: `paused` (pause and resume), and `replicationSpecs` (scale a
 * dedicated cluster and set its compute autoscaling). The new size and
 * autoscaling come from the first region config. Any other field is
 * rejected, so a case never gets a success for an update the mock did not
 * perform.
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
    const { paused, replicationSpecs } = parsed.data;
    if (paused !== undefined) {
      cluster.paused = paused;
    } else if (replicationSpecs) {
      if (cluster.instanceSize === "M0") {
        throw new AtlasError(
          400,
          "CANNOT_SCALE_FREE_CLUSTER",
          "A free cluster cannot be scaled. Upgrade it instead.",
        );
      }
      const region = replicationSpecs[0].regionConfigs[0];
      const compute = region.autoScaling?.compute;
      if (region.electableSpecs) {
        cluster.instanceSize = region.electableSpecs.instanceSize;
      }
      if (compute) {
        cluster.autoScaling = {
          enabled: compute.enabled,
          minInstanceSize: compute.minInstanceSize,
          maxInstanceSize: compute.maxInstanceSize,
        };
      }
    }
    return c.json(clusterJson(project, cluster));
  },
);
