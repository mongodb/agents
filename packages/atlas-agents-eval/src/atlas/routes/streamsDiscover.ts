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

import type { AtlasEnv } from "../support/env.js";
import { AtlasError } from "../support/errors.js";
import { requireProject } from "../support/lookups.js";
import { pagedAtlasPage, streamWorkspaceJson } from "../support/responses.js";

function requireWorkspace(
  c: Parameters<typeof requireProject>[0],
  groupId: string,
  tenantName: string,
) {
  const project = requireProject(c, groupId);
  const workspace = project.streams.workspaces.find(
    (candidate) => candidate.name === tenantName,
  );
  if (!workspace) {
    throw new AtlasError(
      404,
      "STREAM_TENANT_NOT_FOUND",
      `No Stream Processing workspace named ${tenantName}`,
    );
  }
  return { project, workspace };
}

/**
 * The read routes of Atlas Stream Processing, which `atlas_streams_discover`
 * uses. Lists take `pageNum` and `itemsPerPage`. The two fixed paths under
 * `/streams` come before the workspace route so they are not read as a
 * workspace name.
 */
export const streamsDiscoverRoutes = new Hono<AtlasEnv>()
  .get("/groups/:groupId/streams", (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    return c.json(
      pagedAtlasPage(
        project.streams.workspaces.map((workspace) =>
          streamWorkspaceJson(project, workspace, {
            includeConnections: false,
          }),
        ),
        c.req.query(),
      ),
    );
  })
  .get("/groups/:groupId/streams/accountDetails", (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const { cloudProvider, regionName } = c.req.query();
    const details = project.streams.accountDetails.find(
      (candidate) =>
        candidate.cloudProvider === cloudProvider &&
        candidate.regionName === regionName,
    );
    if (!details) {
      throw new AtlasError(
        404,
        "ACCOUNT_DETAILS_NOT_FOUND",
        `No account details for ${cloudProvider}/${regionName}`,
      );
    }
    const { cloudProvider: _provider, regionName: _region, ...rest } = details;
    return c.json(rest);
  })
  .get("/groups/:groupId/streams/privateLinkConnections", (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    return c.json(pagedAtlasPage(project.streams.privateLinks, c.req.query()));
  })
  .get("/groups/:groupId/streams/:tenantName", (c) => {
    const { project, workspace } = requireWorkspace(
      c,
      c.req.param("groupId"),
      c.req.param("tenantName"),
    );
    return c.json(
      streamWorkspaceJson(project, workspace, {
        includeConnections: c.req.query("includeConnections") === "true",
      }),
    );
  })
  .get("/groups/:groupId/streams/:tenantName/connections", (c) => {
    const { workspace } = requireWorkspace(
      c,
      c.req.param("groupId"),
      c.req.param("tenantName"),
    );
    return c.json(pagedAtlasPage(workspace.connections, c.req.query()));
  })
  .get(
    "/groups/:groupId/streams/:tenantName/connections/:connectionName",
    (c) => {
      const { workspace } = requireWorkspace(
        c,
        c.req.param("groupId"),
        c.req.param("tenantName"),
      );
      const name = c.req.param("connectionName");
      const connection = workspace.connections.find(
        (candidate) => candidate.name === name,
      );
      if (!connection) {
        throw new AtlasError(
          404,
          "STREAM_CONNECTION_NOT_FOUND",
          `No connection named ${name} in workspace ${workspace.name}`,
        );
      }
      return c.json(connection);
    },
  )
  .get("/groups/:groupId/streams/:tenantName/processors", (c) => {
    const { workspace } = requireWorkspace(
      c,
      c.req.param("groupId"),
      c.req.param("tenantName"),
    );
    return c.json(pagedAtlasPage(workspace.processors, c.req.query()));
  })
  .get("/groups/:groupId/streams/:tenantName/processor/:processorName", (c) => {
    const { workspace } = requireWorkspace(
      c,
      c.req.param("groupId"),
      c.req.param("tenantName"),
    );
    const name = c.req.param("processorName");
    const processor = workspace.processors.find(
      (candidate) => candidate.name === name,
    );
    if (!processor) {
      throw new AtlasError(
        404,
        "STREAM_PROCESSOR_NOT_FOUND",
        `No processor named ${name} in workspace ${workspace.name}`,
      );
    }
    return c.json(processor);
  });
