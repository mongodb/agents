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
    alerts: z.array(AlertSchema).default([]),
  })
  .refine(
    (project) =>
      new Set(project.clusters.map((c) => c.name)).size ===
      project.clusters.length,
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
