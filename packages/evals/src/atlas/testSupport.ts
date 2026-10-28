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

import { AccountRegistry, type MockAtlasAccount } from "./accounts.js";
import { API_PREFIX, createAtlasApp } from "./app.js";
import type { AtlasFixtureInput } from "./fixtures.js";

export const ORG = "5".padEnd(24, "0");
export const PROJECT = "6".padEnd(24, "0");
export const OTHER_PROJECT = "7".padEnd(24, "0");

/** One project with two clusters and two alerts. Enough for most routes. */
export const baseFixture = {
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
} satisfies AtlasFixtureInput;

export interface TestResponse {
  status: number;
  contentType: string | null;
  // Tests assert on a few fields each, so the body is left loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/**
 * The mock Atlas app with one registered account, called in memory with
 * `app.request()`. No sockets, so route tests stay fast and need no cleanup.
 */
export function createTestAtlas(
  fixture: AtlasFixtureInput = baseFixture,
  clientId = "test-client",
) {
  const registry = new AccountRegistry();
  const app = createAtlasApp(registry);
  const account: MockAtlasAccount = registry.register(clientId, fixture);
  const token = `mock.${Buffer.from(clientId).toString("base64url")}.test`;

  async function send(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: string } = {},
  ): Promise<TestResponse> {
    const res = await app.request(path, {
      method,
      headers: init.headers,
      body: init.body,
    });
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      body: await res.json(),
    };
  }

  /** Call an Atlas route as the registered account. `path` omits the prefix. */
  function call(method: string, path: string, body?: unknown) {
    return send(method, `${API_PREFIX}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return {
    app,
    registry,
    account,
    token,
    send,
    get: (path: string) => call("GET", path),
    patch: (path: string, body: unknown) => call("PATCH", path, body),
    call,
  };
}
