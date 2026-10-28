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
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";

import { AccountRegistry, type MockAtlasAccount } from "./support/accounts.js";
import { createAtlasApp } from "./app.js";
import type { AtlasFixtureInput } from "./fixtures.js";
import { createMockTls } from "./support/tls.js";

export type { MockAtlasAccount, RecordedRequest } from "./support/accounts.js";

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

/**
 * Serves the mock Atlas Admin API (see `createAtlasApp`) over HTTPS. One
 * server serves every case: each case's child MCP server authenticates with
 * its own client id, and the mock keeps a separate account per id.
 */
export async function startMockAtlasApi(): Promise<MockAtlasApi> {
  const tls = await createMockTls();
  const registry = new AccountRegistry();
  const app = createAtlasApp(registry);

  // `serve` types its result as a union of server kinds. With
  // `createServer: https.createServer` it is always an `https.Server`.
  const server = serve({
    fetch: app.fetch,
    port: 0,
    hostname: "127.0.0.1",
    createServer: https.createServer,
    serverOptions: { key: tls.key, cert: tls.cert },
  }) as https.Server;
  if (!server.listening) {
    await new Promise<void>((resolve) => server.once("listening", resolve));
  }
  const { port } = server.address() as AddressInfo;
  const baseUrl = `https://localhost:${port}`;

  return {
    url: baseUrl,
    caCertPath: tls.caCertPath,
    serverEnv(clientId) {
      return {
        MDB_MCP_API_BASE_URL: baseUrl,
        MDB_MCP_API_CLIENT_ID: clientId,
        MDB_MCP_API_CLIENT_SECRET: "mock-secret",
        // The server's fetch uses the system CA store.
        NODE_OPTIONS: "--use-system-ca",
        SSL_CERT_FILE: tls.caCertPath,
        NODE_EXTRA_CA_CERTS: tls.caCertPath,
      };
    },
    register: (clientId, fixture) => registry.register(clientId, fixture),
    async close() {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      server.closeAllConnections();
      await closed;
      tls.dispose();
    },
  };
}
