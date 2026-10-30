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
import { readJsonBody, requireProject } from "../support/lookups.js";
import { flexClusterJson } from "../support/responses.js";

const Body = z.looseObject({
  name: z.string(),
  replicationSpecs: z
    .array(
      z.looseObject({
        regionConfigs: z
          .array(
            z.looseObject({
              providerName: z.string().optional(),
              regionName: z.string().optional(),
              electableSpecs: z
                .looseObject({ instanceSize: z.literal("M10") })
                .optional(),
              autoScaling: z
                .looseObject({
                  compute: z
                    .looseObject({
                      enabled: z.boolean(),
                      minInstanceSize: z.string().optional(),
                      maxInstanceSize: z.string().optional(),
                    })
                    .optional(),
                })
                .optional(),
            }),
          )
          .min(1),
      }),
    )
    .length(1),
});

/**
 * `POST /groups/:groupId/flexClusters:tenantUpgrade`. Upgrades a flex
 * cluster to a dedicated M10. The cluster moves from the project's flex
 * clusters to its clusters, in the provider and region the body names.
 */
export const upgradeFlexClusterRoute = new Hono<AtlasEnv>().post(
  "/groups/:groupId/flexClusters:tenantUpgrade",
  async (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const parsed = Body.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new AtlasError(
        400,
        "INVALID_ATTRIBUTE",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    const { name, replicationSpecs } = parsed.data;
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
    const region = replicationSpecs[0].regionConfigs[0];
    const compute = region.autoScaling?.compute;
    project.flexClusters = project.flexClusters.filter(
      (other) => other !== flex,
    );
    project.clusters.push({
      id: flex.id,
      name,
      instanceSize: "M10",
      provider: region.providerName ?? flex.provider,
      region: region.regionName ?? flex.region,
      mongoDBVersion: flex.mongoDBVersion,
      paused: false,
      state: "IDLE",
      autoScaling: compute && {
        enabled: compute.enabled,
        minInstanceSize: compute.minInstanceSize,
        maxInstanceSize: compute.maxInstanceSize,
      },
      advisor: {
        suggestedIndexes: [],
        dropIndexSuggestions: {
          hiddenIndexes: [],
          redundantIndexes: [],
          unusedIndexes: [],
        },
        schemaAdvice: [],
        slowQueries: [],
      },
    });
    return c.json(flexClusterJson(project, flex));
  },
);
