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

import { AgentEngineClient } from "@repo/agent-engine-chat/agent-engine";
import { waitUntil } from "@vercel/functions";

import { loadConfig } from "../../src/config.js";
import { handleAlertWebhook } from "../../src/handler.js";
import { postToSlack } from "../../src/slack.js";

export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  return handleAlertWebhook(request, {
    config,
    agent: new AgentEngineClient(config.agentEngine),
    postToSlack,
    waitUntil,
    log: (message) => console.log(message),
  });
}
