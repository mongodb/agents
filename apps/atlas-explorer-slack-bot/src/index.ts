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

import "dotenv/config";

import { loadConfig } from "./loadConfig.js";
import { createRuntime } from "./runtime.js";
import { closeSharedMongoConnection } from "@repo/agent-engine-chat/store";

const config = loadConfig(process.env, "socket");
const { bot } = await createRuntime(config);

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  await bot.shutdown();
  await closeSharedMongoConnection();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

try {
  await bot.initialize();
  console.log(
    `⚡️ ${config.slack.botDisplayName} is running in Slack Socket Mode`,
  );
} catch (error) {
  await Promise.allSettled([
    bot.shutdown(),
    closeSharedMongoConnection(),
  ]);
  throw error;
}
