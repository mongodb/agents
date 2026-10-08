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

import { describe, expect, it } from "vitest";

import { gatewayConfigFromEnv } from "./gatewayConfig.js";

describe("gatewayConfigFromEnv", () => {
  it("builds a gateway client config and strips a trailing slash", () => {
    expect(
      gatewayConfigFromEnv({
        AGENTIC_SA_CLIENT_ID: "id",
        AGENTIC_SA_CLIENT_SECRET: "secret",
        AGENTIC_PROJECT_ID: "project",
        AGENTIC_WORKSPACE_ID: "workspace",
        AGENTIC_BASE_URL: "https://example.test/",
      }),
    ).toEqual({
      baseUrl: "https://example.test",
      invokeTarget: "gateway",
      projectId: "project",
      workspaceId: "workspace",
      serviceAccount: { clientId: "id", clientSecret: "secret" },
    });
  });

  it("defaults the base URL to https://agentengine.mongodb.com", () => {
    const env = {
      AGENTIC_SA_CLIENT_ID: "id",
      AGENTIC_SA_CLIENT_SECRET: "secret",
      AGENTIC_PROJECT_ID: "project",
      AGENTIC_WORKSPACE_ID: "workspace",
    };
    expect(gatewayConfigFromEnv(env).baseUrl).toBe(
      "https://agentengine.mongodb.com",
    );
    expect(gatewayConfigFromEnv({ ...env, AGENTIC_BASE_URL: "" }).baseUrl).toBe(
      "https://agentengine.mongodb.com",
    );
  });

  it("names the missing variable", () => {
    expect(() => gatewayConfigFromEnv({})).toThrow(/AGENTIC_SA_CLIENT_ID/);
  });
});
