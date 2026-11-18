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
import { newMockCluster } from "../fixtures.js";
import { AtlasError } from "../support/errors.js";
import { INSTANCE_SIZE, isM30OrLarger } from "../support/instanceSizes.js";
import { readJsonBody, requireProject } from "../support/lookups.js";
import { clusterJson } from "../support/responses.js";

const RegionConfig = z.looseObject({
  providerName: z.enum(["AWS", "GCP", "AZURE"]),
  regionName: z.string().regex(/^[A-Z0-9_]+$/),
  electableSpecs: z.looseObject({
    instanceSize: z.string().regex(INSTANCE_SIZE),
  }),
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
});

const Body = z.looseObject({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  clusterType: z.enum(["REPLICASET", "SHARDED"]),
  mongoDBMajorVersion: z.string().optional(),
  replicationSpecs: z
    .array(
      z.looseObject({ regionConfigs: z.array(RegionConfig).min(1).max(3) }),
    )
    .length(1),
});

/**
 * `POST /groups/:groupId/clusters`. Stores a new dedicated cluster in state
 * `CREATING`. The mock never moves it to `IDLE`. Rejects a name already used
 * by a cluster or flex cluster in the project, and a sharded cluster below
 * M30, as Atlas does.
 */
export const createClusterRoute = new Hono<AtlasEnv>().post(
  "/groups/:groupId/clusters",
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
    const { name, clusterType, mongoDBMajorVersion, replicationSpecs } =
      parsed.data;
    const regionConfigs = replicationSpecs[0].regionConfigs;
    const first = regionConfigs[0];
    const instanceSize = first.electableSpecs.instanceSize;

    if (clusterType === "SHARDED" && !isM30OrLarger(instanceSize)) {
      throw new AtlasError(
        400,
        "INVALID_ATTRIBUTE",
        "A sharded cluster needs an instance size of M30 or larger",
      );
    }
    if (
      new Set(regionConfigs.map((region) => region.regionName)).size !==
      regionConfigs.length
    ) {
      throw new AtlasError(400, "INVALID_ATTRIBUTE", "Regions must be unique");
    }
    const taken = [...project.clusters, ...project.flexClusters].some(
      (existing) => existing.name === name,
    );
    if (taken) {
      throw new AtlasError(
        409,
        "DUPLICATE_CLUSTER_NAME",
        `Cluster ${name} already exists in group ${project.id}`,
      );
    }

    const compute = first.autoScaling?.compute;
    const cluster = newMockCluster({
      name,
      clusterType,
      instanceSize,
      provider: first.providerName,
      region: first.regionName,
      regions: regionConfigs.map((region) => region.regionName),
      mongoDBVersion: mongoDBMajorVersion
        ? `${mongoDBMajorVersion}.0`
        : "8.0.4",
      state: "CREATING",
      autoScaling: compute && {
        enabled: compute.enabled,
        minInstanceSize: compute.minInstanceSize,
        maxInstanceSize: compute.maxInstanceSize,
      },
    });
    project.clusters.push(cluster);
    return c.json(clusterJson(project, cluster), 201);
  },
);
