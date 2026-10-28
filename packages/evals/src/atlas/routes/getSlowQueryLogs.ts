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
import { AtlasError } from "../errors.js";
import { requireProject } from "../lookups.js";
import { nodeHosts } from "../responses.js";

/**
 * `GET /groups/:groupId/processes/:processId/performanceAdvisor/slowQueryLogs`.
 * The process id is a node's `host:port`.
 *
 * The tool asks every node of a cluster. Only the first node reports, so a
 * case's slow queries are not repeated once per node.
 */
export const getSlowQueryLogsRoute = new Hono<AtlasEnv>().get(
  "/groups/:groupId/processes/:processId/performanceAdvisor/slowQueryLogs",
  (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const processId = c.req.param("processId");
    const cluster = project.clusters.find((candidate) =>
      nodeHosts(candidate).includes(processId),
    );
    if (!cluster) {
      throw new AtlasError(404, "PROCESS_NOT_FOUND", `No process ${processId}`);
    }
    const reportsHere = nodeHosts(cluster)[0] === processId;
    return c.json({ slowQueries: reportsHere ? cluster.advisor.slowQueries : [] });
  },
);
