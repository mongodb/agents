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

import type { MockProject, MockStreamWorkspace } from "../fixtures.js";
import type { AtlasEnv } from "../support/env.js";
import { AtlasError } from "../support/errors.js";
import { readJsonBody, requireProject } from "../support/lookups.js";
import { streamWorkspaceJson } from "../support/responses.js";

type Processor = MockStreamWorkspace["processors"][number];

async function parseBody<T extends z.ZodType>(
  c: Parameters<typeof readJsonBody>[0],
  schema: T,
): Promise<z.output<T>> {
  const parsed = schema.safeParse(await readJsonBody(c));
  if (!parsed.success) {
    throw new AtlasError(
      400,
      "INVALID_ATTRIBUTE",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return parsed.data;
}

function findWorkspace(project: MockProject, name: string) {
  const workspace = project.streams.workspaces.find(
    (candidate) => candidate.name === name,
  );
  if (!workspace) {
    throw new AtlasError(
      404,
      "STREAM_TENANT_NOT_FOUND",
      `No Stream Processing workspace named ${name}`,
    );
  }
  return workspace;
}

function findProcessor(workspace: MockStreamWorkspace, name: string) {
  const processor = workspace.processors.find((p) => p.name === name);
  if (!processor) {
    throw new AtlasError(
      404,
      "STREAM_PROCESSOR_NOT_FOUND",
      `No processor named ${name} in workspace ${workspace.name}`,
    );
  }
  return processor;
}

function findConnection(workspace: MockStreamWorkspace, name: string) {
  const connection = workspace.connections.find((c) => c.name === name);
  if (!connection) {
    throw new AtlasError(
      404,
      "STREAM_CONNECTION_NOT_FOUND",
      `No connection named ${name} in workspace ${workspace.name}`,
    );
  }
  return connection;
}

function conflict(code: string, detail: string): never {
  throw new AtlasError(409, code, detail);
}

const WorkspaceBody = z.looseObject({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  dataProcessRegion: z.looseObject({
    cloudProvider: z.enum(["AWS", "AZURE", "GCP"]),
    region: z.string().min(1),
  }),
  streamConfig: z.looseObject({ tier: z.string() }).optional(),
});

const WorkspaceUpdateBody = z.looseObject({
  streamConfig: z.looseObject({ tier: z.string() }).optional(),
  dataProcessRegion: z
    .looseObject({ cloudProvider: z.string(), region: z.string() })
    .optional(),
});

const ConnectionBody = z.looseObject({
  name: z.string().min(1),
  type: z.string().min(1),
});

const ProcessorBody = z.looseObject({
  name: z.string().min(1),
  pipeline: z.array(z.record(z.string(), z.unknown())).min(1),
  tier: z.string().optional(),
});

const ProcessorUpdateBody = z.looseObject({
  name: z.string().optional(),
  pipeline: z.array(z.record(z.string(), z.unknown())).optional(),
  tier: z.string().optional(),
  options: z.looseObject({}).optional(),
});

const StartBody = z.looseObject({ tier: z.string().optional() });

/** Removes a secret before a connection is stored, as Atlas never returns one. */
function withoutSecrets(body: Record<string, unknown>) {
  const authentication = body.authentication;
  if (typeof authentication !== "object" || authentication === null) {
    return body;
  }
  const { password: _password, ...rest } = authentication as Record<
    string,
    unknown
  >;
  return { ...body, authentication: rest };
}

/**
 * The write routes of Atlas Stream Processing: create, update and delete a
 * workspace, a connection and a processor, and start and stop a processor.
 * The mock changes state at once. A processor never goes from `STARTED` to
 * `FAILED` by itself, since the mock has no state over time.
 *
 * Processor actions are `POST .../processor/<name>:<action>`, so the last
 * path segment is split on its `:`.
 */
export const streamsWriteRoutes = new Hono<AtlasEnv>()
  .post("/groups/:groupId/streams", async (c) => createWorkspace(c, false))
  .post("/groups/:groupId/streams:withSampleConnections", async (c) =>
    createWorkspace(c, true),
  )
  .patch("/groups/:groupId/streams/:tenantName", async (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const workspace = findWorkspace(project, c.req.param("tenantName"));
    const body = await parseBody(c, WorkspaceUpdateBody);
    if (body.streamConfig) workspace.tier = body.streamConfig.tier;
    if (body.dataProcessRegion) {
      workspace.cloudProvider = body.dataProcessRegion.cloudProvider;
      workspace.region = body.dataProcessRegion.region;
    }
    return c.json(
      streamWorkspaceJson(project, workspace, { includeConnections: false }),
    );
  })
  .delete("/groups/:groupId/streams/:tenantName", (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const workspace = findWorkspace(project, c.req.param("tenantName"));
    project.streams.workspaces = project.streams.workspaces.filter(
      (other) => other !== workspace,
    );
    return c.json({}, 202);
  })
  .post("/groups/:groupId/streams/:tenantName/connections", async (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const workspace = findWorkspace(project, c.req.param("tenantName"));
    const body = await parseBody(c, ConnectionBody);
    if (workspace.connections.some((other) => other.name === body.name)) {
      conflict(
        "STREAM_CONNECTION_NAME_ALREADY_EXISTS",
        `Connection ${body.name} already exists in workspace ${workspace.name}`,
      );
    }
    const connection = {
      state: "READY",
      ...withoutSecrets(body),
    } as unknown as (typeof workspace.connections)[number];
    workspace.connections.push(connection);
    return c.json(connection);
  })
  .patch(
    "/groups/:groupId/streams/:tenantName/connections/:connectionName",
    async (c) => {
      const project = requireProject(c, c.req.param("groupId"));
      const workspace = findWorkspace(project, c.req.param("tenantName"));
      const connection = findConnection(
        workspace,
        c.req.param("connectionName"),
      );
      const body = await parseBody(c, z.looseObject({}));
      Object.assign(connection, withoutSecrets(body), {
        name: connection.name,
      });
      return c.json(connection);
    },
  )
  .delete(
    "/groups/:groupId/streams/:tenantName/connections/:connectionName",
    (c) => {
      const project = requireProject(c, c.req.param("groupId"));
      const workspace = findWorkspace(project, c.req.param("tenantName"));
      const connection = findConnection(
        workspace,
        c.req.param("connectionName"),
      );
      workspace.connections = workspace.connections.filter(
        (other) => other !== connection,
      );
      return c.json({}, 202);
    },
  )
  .post("/groups/:groupId/streams/:tenantName/processor", async (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const workspace = findWorkspace(project, c.req.param("tenantName"));
    const body = await parseBody(c, ProcessorBody);
    if (workspace.processors.some((other) => other.name === body.name)) {
      conflict(
        "STREAM_PROCESSOR_NAME_ALREADY_EXISTS",
        `Processor ${body.name} already exists in workspace ${workspace.name}`,
      );
    }
    const processor: Processor = {
      ...body,
      state: "CREATED",
      tier: body.tier ?? workspace.tier,
    };
    workspace.processors.push(processor);
    return c.json(processor);
  })
  .patch(
    "/groups/:groupId/streams/:tenantName/processor/:processorName",
    async (c) => {
      const project = requireProject(c, c.req.param("groupId"));
      const workspace = findWorkspace(project, c.req.param("tenantName"));
      const processor = findProcessor(workspace, c.req.param("processorName"));
      if (processor.state === "STARTED") {
        conflict(
          "STREAM_PROCESSOR_INVALID_STATE",
          `Processor ${processor.name} must be stopped before it is changed`,
        );
      }
      const body = await parseBody(c, ProcessorUpdateBody);
      const { options, ...rest } = body;
      Object.assign(processor, rest);
      if (options) {
        processor.options = {
          ...(processor.options as object | undefined),
          ...options,
        };
      }
      return c.json(processor);
    },
  )
  .delete(
    "/groups/:groupId/streams/:tenantName/processor/:processorName",
    (c) => {
      const project = requireProject(c, c.req.param("groupId"));
      const workspace = findWorkspace(project, c.req.param("tenantName"));
      const processor = findProcessor(workspace, c.req.param("processorName"));
      if (processor.state === "STARTED") {
        conflict(
          "STREAM_PROCESSOR_INVALID_STATE",
          `Processor ${processor.name} must be stopped before it is deleted`,
        );
      }
      workspace.processors = workspace.processors.filter(
        (other) => other !== processor,
      );
      return c.json({}, 202);
    },
  )
  .post(
    "/groups/:groupId/streams/:tenantName/processor/:processorAction",
    async (c) => {
      const project = requireProject(c, c.req.param("groupId"));
      const workspace = findWorkspace(project, c.req.param("tenantName"));
      const separator = c.req.param("processorAction").lastIndexOf(":");
      const name = c.req.param("processorAction").slice(0, separator);
      const action = c.req.param("processorAction").slice(separator + 1);
      if (separator < 0 || !["start", "startWith", "stop"].includes(action)) {
        throw new AtlasError(
          404,
          "NOT_IMPLEMENTED_IN_MOCK",
          `Processor action ${c.req.param("processorAction")} is not implemented by the eval mock Atlas API`,
        );
      }
      const processor = findProcessor(workspace, name);
      if (action === "stop") {
        if (processor.state !== "STARTED") {
          conflict(
            "STREAM_PROCESSOR_INVALID_STATE",
            `Processor ${name} is not running`,
          );
        }
        processor.state = "STOPPED";
        return c.json({}, 202);
      }
      if (processor.state === "STARTED") {
        conflict(
          "STREAM_PROCESSOR_INVALID_STATE",
          `Processor ${name} is already running`,
        );
      }
      if (action === "startWith") {
        const body = await parseBody(c, StartBody);
        if (body.tier) processor.tier = body.tier;
      }
      processor.state = "STARTED";
      return c.json({}, 202);
    },
  );

async function createWorkspace(
  c: Parameters<typeof readJsonBody>[0],
  withSample: boolean,
) {
  const project = requireProject(c, c.req.param("groupId") ?? "");
  const body = await parseBody(c, WorkspaceBody);
  if (project.streams.workspaces.some((other) => other.name === body.name)) {
    conflict(
      "STREAM_TENANT_NAME_ALREADY_EXISTS",
      `Workspace ${body.name} already exists in group ${project.id}`,
    );
  }
  const workspace: MockStreamWorkspace = {
    name: body.name,
    cloudProvider: body.dataProcessRegion.cloudProvider,
    region: body.dataProcessRegion.region,
    tier: body.streamConfig?.tier ?? "SP10",
    maxTierSize: "SP50",
    connections: withSample
      ? [{ name: "sample_stream_solar", type: "Sample", state: "READY" }]
      : [],
    processors: [],
  };
  project.streams.workspaces.push(workspace);
  return c.json(
    streamWorkspaceJson(project, workspace, { includeConnections: false }),
  );
}
