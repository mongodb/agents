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

import type { AgentEngineClientConfig } from "@repo/agent-engine-chat/agent-engine";

export interface SpikeConfig {
  /** Secret configured in the Atlas webhook integration (X-MMS-Signature). */
  atlasWebhookSecret: string;
  /** Optional shared token expected in the `?token=` query parameter. */
  urlToken?: string;
  slackBotToken: string;
  slackChannelId: string;
  agentEngine: AgentEngineClientConfig;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(env: Env): SpikeConfig {
  const baseUrl =
    env.AGENTIC_BASE_URL?.trim() || "https://agentic-platform.mongodb.com";
  const agentEngine: AgentEngineClientConfig =
    env.AGENTIC_INVOKE_TARGET?.trim() === "local"
      ? { baseUrl, invokeTarget: "local" }
      : {
          baseUrl,
          invokeTarget: "gateway",
          projectId: required(env, "AGENTIC_PROJECT_ID"),
          workspaceId: required(env, "AGENTIC_WORKSPACE_ID"),
          serviceAccount: {
            clientId: required(env, "AGENTIC_SA_CLIENT_ID"),
            clientSecret: required(env, "AGENTIC_SA_CLIENT_SECRET"),
          },
        };

  return {
    atlasWebhookSecret: required(env, "ATLAS_WEBHOOK_SECRET"),
    ...(env.ATLAS_WEBHOOK_URL_TOKEN?.trim()
      ? { urlToken: env.ATLAS_WEBHOOK_URL_TOKEN.trim() }
      : {}),
    slackBotToken: required(env, "SLACK_BOT_TOKEN"),
    slackChannelId: required(env, "SLACK_ALERT_CHANNEL_ID"),
    agentEngine,
  };
}
