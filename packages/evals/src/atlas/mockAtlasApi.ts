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

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import selfsigned from "selfsigned";

import {
  AtlasFixtureSchema,
  type AtlasFixture,
  type AtlasFixtureInput,
  type MockCluster,
  type MockProject,
} from "./fixtures.js";

export interface RecordedRequest {
  readonly method: string;
  /** Path and query, as received. */
  readonly url: string;
  readonly status: number;
}

/** One case's view of the mock: its seeded data, and what was asked of it. */
export interface MockAtlasAccount {
  readonly clientId: string;
  /** Current data, including changes made through write routes. */
  state(): AtlasFixture;
  requests(): readonly RecordedRequest[];
  /** Forget the account. Later requests with its token get a 401. */
  release(): void;
}

export interface MockAtlasApi {
  /** `https://localhost:<port>`. Pass it as `MDB_MCP_API_BASE_URL`. */
  readonly url: string;
  /** PEM file the child process must trust. */
  readonly caCertPath: string;
  /**
   * Environment for a child `mongodb-mcp-server` that should act as
   * `clientId`. The mock tells accounts apart by this id.
   */
  serverEnv(clientId: string): Record<string, string>;
  register(clientId: string, fixture: AtlasFixtureInput): MockAtlasAccount;
  close(): Promise<void>;
}

interface Account {
  fixture: AtlasFixture;
  requests: RecordedRequest[];
}

interface Reply {
  status: number;
  body: unknown;
}

interface RouteContext {
  fixture: AtlasFixture;
  params: string[];
  query: URLSearchParams;
  body: unknown;
}

type Route = readonly [
  method: string,
  pattern: RegExp,
  handler: (ctx: RouteContext) => Reply,
];

const API_PREFIX = "/api/atlas/v2";
const ATLAS_CONTENT_TYPE = "application/vnd.atlas.2025-03-12+json";
const ID = "([0-9a-f]{24})";
const NAME = "([^/]+)";

const ok = (body: unknown): Reply => ({ status: 200, body });

function notFound(errorCode: string, detail: string): Reply {
  return { status: 404, body: { error: 404, errorCode, detail } };
}

function stableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("/")).digest("hex").slice(0, 24);
}

function nodeHosts(cluster: MockCluster): string[] {
  return (
    cluster.hosts ??
    [0, 1, 2].map(
      (n) => `${cluster.name}-shard-00-0${n}.mock.mongodb.net:27017`,
    )
  );
}

function clusterJson(project: MockProject, cluster: MockCluster) {
  return {
    id: stableId(project.id, cluster.name),
    groupId: project.id,
    name: cluster.name,
    clusterType: "REPLICASET",
    stateName: cluster.state,
    paused: cluster.paused,
    mongoDBVersion: cluster.mongoDBVersion,
    connectionStrings: {
      standard: `mongodb://${nodeHosts(cluster).join(",")}/?ssl=true`,
      standardSrv: `mongodb+srv://${cluster.name}.mock.mongodb.net`,
    },
    replicationSpecs: [
      {
        regionConfigs: [
          {
            providerName: cluster.provider,
            regionName: cluster.region,
            priority: 7,
            electableSpecs: {
              instanceSize: cluster.instanceSize,
              nodeCount: 3,
            },
          },
        ],
      },
    ],
  };
}

function project(ctx: RouteContext): MockProject | undefined {
  return ctx.fixture.projects.find((p) => p.id === ctx.params[0]);
}

function withProject(
  handler: (ctx: RouteContext, project: MockProject) => Reply,
): (ctx: RouteContext) => Reply {
  return (ctx) => {
    const found = project(ctx);
    return found
      ? handler(ctx, found)
      : notFound("GROUP_NOT_FOUND", `No project with ID ${ctx.params[0]}`);
  };
}

function withCluster(
  handler: (
    ctx: RouteContext,
    project: MockProject,
    cluster: MockCluster,
  ) => Reply,
): (ctx: RouteContext) => Reply {
  return withProject((ctx, found) => {
    const cluster = found.clusters.find(
      (c) => c.name === decodeURIComponent(ctx.params[1]),
    );
    return cluster
      ? handler(ctx, found, cluster)
      : notFound(
          "CLUSTER_NOT_FOUND",
          `No cluster named ${ctx.params[1]} exists in group ${found.id}`,
        );
  });
}

function page<T>(items: readonly T[]) {
  return ok({ results: items, totalCount: items.length, links: [] });
}

const routes: readonly Route[] = [
  ["GET", /^\/orgs$/, ({ fixture }) => page(fixture.orgs)],
  [
    "GET",
    /^\/groups$/,
    ({ fixture }) =>
      page(
        fixture.projects.map((p) => ({
          id: p.id,
          name: p.name,
          orgId: p.orgId,
          clusterCount: p.clusters.length,
          created: "2026-01-01T00:00:00Z",
        })),
      ),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}$`),
    withProject((_ctx, p) =>
      ok({ id: p.id, name: p.name, orgId: p.orgId, clusterCount: p.clusters.length }),
    ),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/clusters$`),
    withProject((_ctx, p) => page(p.clusters.map((c) => clusterJson(p, c)))),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/flexClusters$`),
    withProject(() => page([])),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/clusters/${NAME}$`),
    withCluster((_ctx, p, c) => ok(clusterJson(p, c))),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/flexClusters/${NAME}$`),
    withProject((ctx) =>
      notFound("CLUSTER_NOT_FOUND", `No flex cluster named ${ctx.params[1]}`),
    ),
  ],
  [
    "PATCH",
    new RegExp(`^/groups/${ID}/clusters/${NAME}$`),
    withCluster((ctx, p, c) => {
      const { paused } = (ctx.body ?? {}) as { paused?: boolean };
      if (typeof paused === "boolean") c.paused = paused;
      return ok(clusterJson(p, c));
    }),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/alerts$`),
    withProject((ctx, p) => {
      const status = ctx.query.get("status");
      return page(p.alerts.filter((a) => !status || a.status === status));
    }),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/clusters/${NAME}/performanceAdvisor/suggestedIndexes$`),
    withCluster((_ctx, _p, c) =>
      ok({
        content: { shapes: [], suggestedIndexes: c.advisor.suggestedIndexes },
      }),
    ),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/clusters/${NAME}/performanceAdvisor/dropIndexSuggestions$`),
    withCluster((_ctx, _p, c) =>
      ok({ content: c.advisor.dropIndexSuggestions }),
    ),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/clusters/${NAME}/performanceAdvisor/schemaAdvice$`),
    withCluster((_ctx, _p, c) =>
      ok({ content: { recommendations: c.advisor.schemaAdvice } }),
    ),
  ],
  [
    "GET",
    new RegExp(`^/groups/${ID}/processes/${NAME}/performanceAdvisor/slowQueryLogs$`),
    withProject((ctx, p) => {
      const processId = decodeURIComponent(ctx.params[1]);
      const cluster = p.clusters.find((c) => nodeHosts(c).includes(processId));
      if (!cluster) {
        return notFound("PROCESS_NOT_FOUND", `No process ${processId}`);
      }
      // The tool asks every node. Only the first reports, so a case's slow
      // queries are not repeated once per node.
      const first = nodeHosts(cluster)[0] === processId;
      return ok({ slowQueries: first ? cluster.advisor.slowQueries : [] });
    }),
  ],
];

async function readBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? text : undefined;
}

function clientIdFromBasicAuth(header: string | undefined): string | undefined {
  if (!header?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return decoded.split(":")[0] || undefined;
}

function tokenFor(clientId: string): string {
  const id = Buffer.from(clientId).toString("base64url");
  return `mock.${id}.${randomBytes(6).toString("hex")}`;
}

function clientIdFromToken(header: string | undefined): string | undefined {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const id = token?.split(".")[1];
  return id ? Buffer.from(id, "base64url").toString("utf8") : undefined;
}

/**
 * A stand-in for the Atlas Admin API, over HTTPS because the Atlas token
 * library refuses plain HTTP. One server serves every case: each case's
 * child MCP server authenticates with its own client id, and the mock keeps
 * a separate account per id.
 *
 * Only the routes the agents' tools use exist. Any other request gets a 404
 * that names the method and path, so a missing route is obvious.
 */
export async function startMockAtlasApi(): Promise<MockAtlasApi> {
  const pems = await selfsigned.generate(
    [{ name: "commonName", value: "localhost" }],
    {
      notAfterDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      keySize: 2048,
      extensions: [
        // Node only trusts a self-signed certificate that says it is a CA.
        { name: "basicConstraints", cA: true },
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
          ],
        },
      ],
    },
  );
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-atlas-"));
  const caCertPath = path.join(certDir, "ca.pem");
  fs.writeFileSync(caCertPath, pems.cert);

  const accounts = new Map<string, Account>();

  const server = https.createServer(
    { key: pems.private, cert: pems.cert },
    async (req, res) => {
      const url = new URL(req.url ?? "/", "https://localhost");
      const raw = await readBody(req);
      const send = (status: number, body: unknown, account?: Account) => {
        account?.requests.push({
          method: req.method ?? "",
          url: `${url.pathname}${url.search}`,
          status,
        });
        res.writeHead(status, { "content-type": ATLAS_CONTENT_TYPE });
        res.end(JSON.stringify(body));
      };

      if (req.method === "POST" && url.pathname === "/api/oauth/token") {
        const form = new URLSearchParams(raw ?? "");
        const clientId =
          clientIdFromBasicAuth(req.headers.authorization) ??
          form.get("client_id") ??
          undefined;
        if (!clientId || !accounts.has(clientId)) {
          return send(401, { error: "invalid_client" });
        }
        return send(200, {
          access_token: tokenFor(clientId),
          token_type: "Bearer",
          expires_in: 3600,
        });
      }

      const clientId = clientIdFromToken(req.headers.authorization);
      const account = clientId ? accounts.get(clientId) : undefined;
      if (!account) {
        return send(401, { error: 401, errorCode: "UNAUTHORIZED" });
      }

      if (url.pathname.startsWith(API_PREFIX)) {
        const rest = url.pathname.slice(API_PREFIX.length);
        for (const [method, pattern, handler] of routes) {
          const match = method === req.method ? pattern.exec(rest) : null;
          if (!match) continue;
          let body: unknown;
          try {
            body = raw ? JSON.parse(raw) : undefined;
          } catch {
            return send(400, { error: 400, errorCode: "INVALID_JSON" }, account);
          }
          const reply = handler({
            fixture: account.fixture,
            params: match.slice(1),
            query: url.searchParams,
            body,
          });
          return send(reply.status, reply.body, account);
        }
      }
      send(
        404,
        {
          error: 404,
          errorCode: "NOT_IMPLEMENTED_IN_MOCK",
          detail: `${req.method} ${url.pathname} is not implemented by the eval mock Atlas API`,
        },
        account,
      );
    },
  );
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;
  const baseUrl = `https://localhost:${port}`;

  return {
    url: baseUrl,
    caCertPath,
    serverEnv(clientId) {
      return {
        MDB_MCP_API_BASE_URL: baseUrl,
        MDB_MCP_API_CLIENT_ID: clientId,
        MDB_MCP_API_CLIENT_SECRET: "mock-secret",
        // The server's fetch uses the system CA store.
        NODE_OPTIONS: "--use-system-ca",
        SSL_CERT_FILE: caCertPath,
        NODE_EXTRA_CA_CERTS: caCertPath,
      };
    },
    register(clientId, fixtureInput) {
      if (accounts.has(clientId)) {
        throw new Error(`Mock Atlas account ${clientId} already exists`);
      }
      const account: Account = {
        fixture: AtlasFixtureSchema.parse(fixtureInput),
        requests: [],
      };
      accounts.set(clientId, account);
      return {
        clientId,
        state: () => structuredClone(account.fixture),
        requests: () => [...account.requests],
        release: () => void accounts.delete(clientId),
      };
    },
    async close() {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      server.closeAllConnections();
      await closed;
      fs.rmSync(certDir, { recursive: true, force: true });
    },
  };
}
