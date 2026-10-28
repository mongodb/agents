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

import https from "node:https";
import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMockAtlasApi, type MockAtlasApi } from "./mockAtlasApi.js";

const ORG = "5".padEnd(24, "0");
const PROJECT = "6".padEnd(24, "0");
const OTHER_PROJECT = "7".padEnd(24, "0");

const fixture = {
  orgs: [{ id: ORG, name: "Acme" }],
  projects: [
    {
      id: PROJECT,
      name: "prod",
      orgId: ORG,
      clusters: [{ name: "c1" }, { name: "c2", paused: true }],
      alerts: [
        { id: "a1", eventTypeName: "HOST_DOWN" },
        { id: "a2", eventTypeName: "OLD", status: "CLOSED" as const },
      ],
    },
  ],
};

let mock: MockAtlasApi;

beforeAll(async () => {
  mock = await startMockAtlasApi();
});

afterAll(async () => {
  await mock.close();
});

interface Response {
  status: number;
  body: any;
  contentType: string;
}

function request(
  method: string,
  pathAndQuery: string,
  options: { headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${mock.url}${pathAndQuery}`,
      {
        method,
        ca: fs.readFileSync(mock.caCertPath),
        headers: options.headers,
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(text),
            contentType: String(res.headers["content-type"]),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

async function tokenFor(clientId: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:mock-secret`).toString("base64");
  const res = await request("POST", "/api/oauth/token", {
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  expect(res.status).toBe(200);
  return res.body.access_token;
}

async function api(token: string, method: string, apiPath: string, body?: unknown) {
  return request(method, `/api/atlas/v2${apiPath}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("mock Atlas API", () => {
  it("hands out a bearer token only to a registered client id", async () => {
    const account = mock.register("known", fixture);
    const res = await request("POST", "/api/oauth/token", {
      headers: {
        authorization: `Basic ${Buffer.from("nobody:x").toString("base64")}`,
      },
    });
    expect(res.status).toBe(401);

    const token = await tokenFor("known");
    expect((await api(token, "GET", "/orgs")).status).toBe(200);
    expect((await request("GET", "/api/atlas/v2/orgs")).status).toBe(401);
    account.release();
  });

  it("serves the seeded projects, clusters, and alerts", async () => {
    const account = mock.register("reader", fixture);
    const token = await tokenFor("reader");

    const projects = await api(token, "GET", "/groups");
    expect(projects.contentType).toContain("application/vnd.atlas");
    expect(projects.body.results).toMatchObject([
      { id: PROJECT, name: "prod", orgId: ORG, clusterCount: 2 },
    ]);

    const clusters = await api(token, "GET", `/groups/${PROJECT}/clusters`);
    expect(clusters.body.results.map((c: any) => c.name)).toEqual(["c1", "c2"]);
    expect(clusters.body.results[0]).toMatchObject({
      stateName: "IDLE",
      paused: false,
      replicationSpecs: [
        { regionConfigs: [{ electableSpecs: { instanceSize: "M10" } }] },
      ],
    });

    const open = await api(token, "GET", `/groups/${PROJECT}/alerts?status=OPEN`);
    expect(open.body.results.map((a: any) => a.id)).toEqual(["a1"]);
    account.release();
  });

  it("applies a pause to that account only", async () => {
    const a = mock.register("writer-a", fixture);
    const b = mock.register("writer-b", fixture);
    const tokenA = await tokenFor("writer-a");
    const tokenB = await tokenFor("writer-b");

    const patched = await api(
      tokenA,
      "PATCH",
      `/groups/${PROJECT}/clusters/c1`,
      { paused: true },
    );
    expect(patched.status).toBe(200);

    expect(a.state().projects[0].clusters[0].paused).toBe(true);
    expect(b.state().projects[0].clusters[0].paused).toBe(false);
    const seenByB = await api(tokenB, "GET", `/groups/${PROJECT}/clusters/c1`);
    expect(seenByB.body.paused).toBe(false);
    a.release();
    b.release();
  });

  it("names the group or cluster that does not exist", async () => {
    const account = mock.register("misses", fixture);
    const token = await tokenFor("misses");

    const group = await api(token, "GET", `/groups/${OTHER_PROJECT}`);
    expect(group.status).toBe(404);
    expect(group.body.errorCode).toBe("GROUP_NOT_FOUND");

    const cluster = await api(token, "GET", `/groups/${PROJECT}/clusters/nope`);
    expect(cluster.status).toBe(404);
    expect(cluster.body.errorCode).toBe("CLUSTER_NOT_FOUND");
    account.release();
  });

  it("answers an unimplemented route with a 404 that names it", async () => {
    const account = mock.register("unknown-route", fixture);
    const token = await tokenFor("unknown-route");

    const res = await api(token, "DELETE", `/groups/${PROJECT}/clusters/c1`);
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("NOT_IMPLEMENTED_IN_MOCK");
    expect(res.body.detail).toContain(`DELETE /api/atlas/v2/groups/${PROJECT}`);
    account.release();
  });

  it("records each request with its status", async () => {
    const account = mock.register("recorded", fixture);
    const token = await tokenFor("recorded");
    await api(token, "GET", "/orgs");
    await api(token, "GET", `/groups/${OTHER_PROJECT}`);

    expect(account.requests()).toEqual([
      { method: "GET", url: "/api/atlas/v2/orgs", status: 200 },
      { method: "GET", url: `/api/atlas/v2/groups/${OTHER_PROJECT}`, status: 404 },
    ]);
    account.release();
  });

  it("stops serving a released account", async () => {
    const account = mock.register("released", fixture);
    const token = await tokenFor("released");
    account.release();
    expect((await api(token, "GET", "/orgs")).status).toBe(401);
  });

  it("refuses a duplicate client id and a malformed fixture", () => {
    const account = mock.register("dup", fixture);
    expect(() => mock.register("dup", fixture)).toThrow(/already exists/);
    expect(() =>
      mock.register("bad", { projects: [{ id: "short", name: "x", orgId: ORG }] }),
    ).toThrow(/24 lowercase hex/);
    account.release();
  });

  it("reports slow queries once, not once per node", async () => {
    const account = mock.register("slow", {
      projects: [
        {
          id: PROJECT,
          name: "prod",
          orgId: ORG,
          clusters: [
            {
              name: "c1",
              advisor: { slowQueries: [{ namespace: "a.b", line: "slow" }] },
            },
          ],
        },
      ],
    });
    const token = await tokenFor("slow");
    const hosts = (
      await api(token, "GET", `/groups/${PROJECT}/clusters/c1`)
    ).body.connectionStrings.standard
      .replace("mongodb://", "")
      .replace("/?ssl=true", "")
      .split(",");

    const counts = await Promise.all(
      hosts.map(async (host: string) => {
        const res = await api(
          token,
          "GET",
          `/groups/${PROJECT}/processes/${encodeURIComponent(host)}/performanceAdvisor/slowQueryLogs`,
        );
        return res.body.slowQueries.length;
      }),
    );
    expect(counts).toEqual([1, 0, 0]);
    account.release();
  });
});
