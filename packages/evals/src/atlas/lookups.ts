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

import type { Context } from "hono";

import type { AtlasEnv } from "./env.js";
import { AtlasError } from "./errors.js";
import type { MockCluster, MockProject } from "./fixtures.js";

export function requireProject(
  c: Context<AtlasEnv>,
  groupId: string,
): MockProject {
  const project = c.var.account.fixture.projects.find((p) => p.id === groupId);
  if (!project) {
    throw new AtlasError(404, "GROUP_NOT_FOUND", `No project with ID ${groupId}`);
  }
  return project;
}

export function requireCluster(
  c: Context<AtlasEnv>,
  groupId: string,
  clusterName: string,
): { project: MockProject; cluster: MockCluster } {
  const project = requireProject(c, groupId);
  const cluster = project.clusters.find((candidate) => candidate.name === clusterName);
  if (!cluster) {
    throw new AtlasError(
      404,
      "CLUSTER_NOT_FOUND",
      `No cluster named ${clusterName} exists in group ${project.id}`,
    );
  }
  return { project, cluster };
}

/** The JSON body of a request, or `undefined` when there is none. */
export async function readJsonBody(c: Context<AtlasEnv>): Promise<unknown> {
  const text = await c.req.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new AtlasError(400, "INVALID_JSON", "The request body is not JSON");
  }
}
