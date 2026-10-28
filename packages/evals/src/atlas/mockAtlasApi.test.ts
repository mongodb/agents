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

import fs from "node:fs";
import https from "node:https";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMockAtlasApi, type MockAtlasApi } from "./mockAtlasApi.js";
import { baseFixture } from "./testSupport.js";

/**
 * Route behaviour is covered next to each route, through `app.request()`.
 * These tests cover what only a real server shows: HTTPS with the mock's own
 * certificate, and the environment handed to a child MCP server.
 */
let mock: MockAtlasApi;

beforeAll(async () => {
  mock = await startMockAtlasApi();
});

afterAll(async () => {
  await mock.close();
});

function request(
  method: string,
  pathAndQuery: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${mock.url}${pathAndQuery}`,
      { method, ca: fs.readFileSync(mock.caCertPath), headers },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("startMockAtlasApi", () => {
  it("serves the OAuth flow and a route over HTTPS", async () => {
    const account = mock.register("e2e", baseFixture);
    const basic = Buffer.from("e2e:mock-secret").toString("base64");
    const token = await request("POST", "/api/oauth/token", {
      authorization: `Basic ${basic}`,
    });
    const orgs = await request("GET", "/api/atlas/v2/orgs", {
      authorization: `Bearer ${token.body.access_token}`,
    });

    expect(orgs.status).toBe(200);
    expect(orgs.body.results).toHaveLength(1);
    expect(account.requests()).toEqual([
      { method: "GET", url: "/api/atlas/v2/orgs", status: 200 },
    ]);
    account.release();
  });

  it("is not reachable by a client that does not trust its certificate", async () => {
    await expect(
      new Promise((resolve, reject) => {
        https
          .get(`${mock.url}/api/atlas/v2/orgs`, resolve)
          .on("error", reject);
      }),
    ).rejects.toThrow(/self-signed|certificate/i);
  });

  it("builds the environment for a child MCP server", () => {
    expect(mock.serverEnv("case-1")).toEqual({
      MDB_MCP_API_BASE_URL: mock.url,
      MDB_MCP_API_CLIENT_ID: "case-1",
      MDB_MCP_API_CLIENT_SECRET: "mock-secret",
      NODE_OPTIONS: "--use-system-ca",
      SSL_CERT_FILE: mock.caCertPath,
      NODE_EXTRA_CA_CERTS: mock.caCertPath,
    });
  });

  it("refuses a duplicate client id", () => {
    const account = mock.register("dup", baseFixture);

    expect(() => mock.register("dup", baseFixture)).toThrow(/already exists/);
    account.release();
  });

  it("removes its certificate directory on close", async () => {
    const other = await startMockAtlasApi();
    const certPath = other.caCertPath;
    expect(fs.existsSync(certPath)).toBe(true);

    await other.close();

    expect(fs.existsSync(certPath)).toBe(false);
  });
});
