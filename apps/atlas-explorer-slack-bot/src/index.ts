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
