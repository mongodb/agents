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

import { randomUUID } from "node:crypto";

import { z } from "zod";

const objectId = z
  .string()
  .regex(/^[0-9a-f]{24}$/, "Atlas ids are 24 lowercase hex characters");

const ClusterSchema = z.object({
  /** Atlas returns an id next to the name. Nothing looks a cluster up by it. */
  id: z.string().default(() => randomUUID()),
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  instanceSize: z.string().default("M10"),
  provider: z.string().default("AWS"),
  region: z.string().default("US_EAST_1"),
  mongoDBVersion: z.string().default("8.0.4"),
  paused: z.boolean().default(false),
  /** `REPLICASET`, or `SHARDED` for a single-shard cluster. */
  clusterType: z.enum(["REPLICASET", "SHARDED"]).default("REPLICASET"),
  /**
   * Every region, highest priority first. The first is `region`. Leave it out
   * for a single-region cluster.
   */
  regions: z.array(z.string()).min(1).optional(),
  /** Compute autoscaling. `M0` is a free cluster, which has none. */
  autoScaling: z
    .object({
      enabled: z.boolean(),
      minInstanceSize: z.string().optional(),
      maxInstanceSize: z.string().optional(),
    })
    .optional(),
  state: z.enum(["IDLE", "CREATING", "UPDATING", "REPAIRING"]).default("IDLE"),
  /** `host:port` of each node. The slow query endpoint is keyed by these. */
  hosts: z.array(z.string()).min(1).optional(),
  /** Performance Advisor payloads, in the shape the Atlas API returns. */
  advisor: z
    .object({
      suggestedIndexes: z.array(z.record(z.string(), z.unknown())).default([]),
      dropIndexSuggestions: z
        .object({
          hiddenIndexes: z.array(z.unknown()).default([]),
          redundantIndexes: z.array(z.unknown()).default([]),
          unusedIndexes: z.array(z.unknown()).default([]),
        })
        .prefault({}),
      schemaAdvice: z.array(z.unknown()).default([]),
      slowQueries: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .prefault({}),
});

const FlexClusterSchema = z.object({
  id: z.string().default(() => randomUUID()),
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  provider: z.string().default("AWS"),
  region: z.string().default("US_EAST_1"),
  mongoDBVersion: z.string().default("8.0.4"),
  state: z.enum(["IDLE", "CREATING", "UPDATING", "REPAIRING"]).default("IDLE"),
});

const SampleDatasetLoadSchema = z.object({
  id: objectId,
  clusterName: z.string(),
  state: z.enum(["WORKING", "COMPLETED", "FAILED"]).default("WORKING"),
  createDate: z.string(),
});

/** A connection or processor keeps whatever fields the fixture gives it. */
const StreamConnectionSchema = z.looseObject({
  name: z.string(),
  type: z.string(),
});

const StreamProcessorSchema = z.looseObject({
  name: z.string(),
  state: z.enum(["CREATED", "STARTED", "STOPPED", "FAILED"]).default("CREATED"),
  tier: z.string().default("SP10"),
});

const StreamWorkspaceSchema = z.object({
  name: z.string(),
  cloudProvider: z.string().default("AWS"),
  region: z.string().default("VIRGINIA_USA"),
  tier: z.string().default("SP10"),
  maxTierSize: z.string().default("SP50"),
  connections: z.array(StreamConnectionSchema).default([]),
  processors: z.array(StreamProcessorSchema).default([]),
});

const StreamsSchema = z.object({
  workspaces: z.array(StreamWorkspaceSchema).default([]),
  /** PrivateLink connections, in the shape Atlas returns them. */
  privateLinks: z.array(z.looseObject({ _id: z.string() })).default([]),
  /** Atlas account details per cloud provider and region. */
  accountDetails: z
    .array(
      z.looseObject({ cloudProvider: z.string(), regionName: z.string() }),
    )
    .default([]),
});

const AccessListEntrySchema = z.object({
  ipAddress: z.string(),
  comment: z.string().default(""),
});

const AlertSchema = z.object({
  id: z.string(),
  status: z.enum(["OPEN", "TRACKING", "CLOSED"]).default("OPEN"),
  eventTypeName: z.string(),
  created: z.string().default("2026-01-01T00:00:00Z"),
  updated: z.string().default("2026-01-01T00:00:00Z"),
  acknowledgementComment: z.string().default(""),
});

const ProjectSchema = z
  .object({
    id: objectId,
    name: z.string(),
    orgId: objectId,
    clusters: z.array(ClusterSchema).default([]),
    flexClusters: z.array(FlexClusterSchema).default([]),
    /** Sample dataset loads requested so far. The mock never finishes one. */
    sampleDatasetLoads: z.array(SampleDatasetLoadSchema).default([]),
    /** IP addresses allowed to connect to the project's clusters. */
    accessList: z.array(AccessListEntrySchema).default([]),
    alerts: z.array(AlertSchema).default([]),
    /** Atlas Stream Processing workspaces and networking. */
    streams: StreamsSchema.prefault({}),
  })
  .refine(
    (project) =>
      new Set([...project.clusters, ...project.flexClusters].map((c) => c.name))
        .size ===
      project.clusters.length + project.flexClusters.length,
    { message: "Cluster names must be unique within a project" },
  );

/** What a case's mock Atlas account holds. Seeded per case. */
export const AtlasFixtureSchema = z.object({
  orgs: z.array(z.object({ id: objectId, name: z.string() })).default([]),
  projects: z.array(ProjectSchema).default([]),
});

export type AtlasFixtureInput = z.input<typeof AtlasFixtureSchema>;
export type AtlasFixture = z.output<typeof AtlasFixtureSchema>;
export type MockProject = AtlasFixture["projects"][number];
export type MockCluster = MockProject["clusters"][number];
export type MockAccessListEntry = MockProject["accessList"][number];
export type MockStreamWorkspace = MockProject["streams"]["workspaces"][number];
export type MockFlexCluster = MockProject["flexClusters"][number];

/** A cluster a write route creates, with the fixture defaults filled in. */
export function newMockCluster(input: z.input<typeof ClusterSchema>): MockCluster {
  return ClusterSchema.parse(input);
}
