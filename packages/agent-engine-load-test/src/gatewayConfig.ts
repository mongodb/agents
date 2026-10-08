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

import { config as loadDotenv } from "dotenv";

import type { AgentEngineClientConfig } from "@repo/agent-engine-chat/agent-engine";

const DEFAULT_BASE_URL = "https://agentengine.mongodb.com";

export function loadEnvFile(file: string): void {
  loadDotenv({ path: file });
}

export function gatewayConfigFromEnv(
  env: Record<string, string | undefined>,
): AgentEngineClientConfig {
  const clientId = required(env, "AGENTIC_SA_CLIENT_ID");
  const clientSecret = required(env, "AGENTIC_SA_CLIENT_SECRET");
  const projectId = required(env, "AGENTIC_PROJECT_ID");
  const workspaceId = required(env, "AGENTIC_WORKSPACE_ID");
  const baseUrl = (env["AGENTIC_BASE_URL"] || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  return {
    baseUrl,
    invokeTarget: "gateway",
    projectId,
    workspaceId,
    serviceAccount: { clientId, clientSecret },
  };
}

function required(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Set it in the environment or in .env.`);
  }
  return value;
}
