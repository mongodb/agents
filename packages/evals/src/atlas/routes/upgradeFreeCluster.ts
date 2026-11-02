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

const Body = z.looseObject({
  name: z.string(),
  providerSettings: z.looseObject({
    instanceSizeName: z.enum(["FLEX", "M10"]),
    providerName: z.string().optional(),
    backingProviderName: z.string().optional(),
    regionName: z.string().optional(),
    autoScaling: z
      .looseObject({
        compute: z
          .looseObject({
            minInstanceSize: z.string().optional(),
            maxInstanceSize: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
  autoScaling: z
    .looseObject({
      compute: z.looseObject({ enabled: z.boolean() }).optional(),
    })
    .optional(),
});

/**
 * `POST /groups/:groupId/clusters/tenantUpgrade`. Upgrades a free (`M0`)
 * cluster to Flex or to a dedicated M10. A Flex upgrade moves the cluster
 * from the project's clusters to its flex clusters. An M10 upgrade resizes it
 * in place and keeps the provider and region it already has when the body
 * does not name them.
 */
export const upgradeFreeClusterRoute = new Hono<AtlasEnv>().post(
  "/groups/:groupId/clusters/tenantUpgrade",
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
    const { name, providerSettings, autoScaling } = parsed.data;
    const cluster = project.clusters.find(
      (candidate) => candidate.name === name,
    );
    if (!cluster) {
      throw new AtlasError(
        404,
        "CLUSTER_NOT_FOUND",
        `No cluster named ${name} exists in group ${project.id}`,
      );
    }
    if (cluster.instanceSize !== "M0") {
      throw new AtlasError(
        400,
        "CANNOT_UPGRADE_NON_FREE_CLUSTER",
        `Cluster ${name} is not a free cluster`,
      );
    }

    if (providerSettings.instanceSizeName === "FLEX") {
      project.clusters = project.clusters.filter((other) => other !== cluster);
      project.flexClusters.push({
        id: cluster.id,
        name,
        provider: providerSettings.backingProviderName ?? cluster.provider,
        region: providerSettings.regionName ?? cluster.region,
        mongoDBVersion: cluster.mongoDBVersion,
        state: "IDLE",
      });
    } else {
      cluster.instanceSize = "M10";
      cluster.provider = providerSettings.providerName ?? cluster.provider;
      cluster.region = providerSettings.regionName ?? cluster.region;
      const compute = providerSettings.autoScaling?.compute;
      cluster.autoScaling = {
        enabled: autoScaling?.compute?.enabled ?? false,
        minInstanceSize: compute?.minInstanceSize,
        maxInstanceSize: compute?.maxInstanceSize,
      };
    }
    return c.json({ id: cluster.id, name, groupId: project.id });
  },
);
